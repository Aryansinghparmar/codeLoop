import { createConfig } from './config/config';
import { loadEnvironment } from './config/env';
import { AgentLoop } from './agent/agent-loop';
import { OpenAiResponsesProvider } from './llm/openai/responses-provider';
import { NvidiaNimChatProvider } from './llm/nvidia/chat-provider';
import { createBuiltinRegistry } from './tools/builtins';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { JsonlSessionStore } from './session/jsonl-store';
import { event, newSession } from './session/session';
import { redactSecrets } from './shared/redact';
import { webSearchTool } from './web/search-tool';
import { McpServerRegistry } from './mcp/server-registry';
import { StdioMcpClient } from './mcp/stdio-client';
import type { LlmMessage } from './llm/provider';
import { StdioLspTransport } from './lsp/stdio-transport';
import { LspClient } from './lsp/json-rpc-client';
import { definitionTool, referencesTool } from './lsp/tools';
import { pathToFileURL } from 'node:url';

async function main(): Promise<void> {
  const projectRoot = process.env.CODELOOP_PROJECT_ROOT ?? process.cwd();
  loadEnvironment(projectRoot);
  const config = createConfig(projectRoot);
  const builtins = createBuiltinRegistry(config);
  const providerChoice = process.env.CODELOOP_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'nvidia');
  const provider = providerChoice === 'openai'
    ? new OpenAiResponsesProvider(config)
    : new NvidiaNimChatProvider(config);
  const optionalServers = new McpServerRegistry();
  let lspClient: LspClient | undefined;

  if (process.env.CODELOOP_ENABLE_WEB_SEARCH === 'yes') builtins.registry.register(webSearchTool);
  const mcpCommand = process.env.CODELOOP_MCP_COMMAND?.trim();
  if (mcpCommand) {
    const rawArgs = process.env.CODELOOP_MCP_ARGS?.trim();
    let args: string[] = [];
    if (rawArgs) {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) throw new Error('MCP arguments must be a JSON string array.');
        args = parsed;
      } catch (error) {
        throw new Error(`Invalid CODELOOP_MCP_ARGS: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await optionalServers.register(new StdioMcpClient(mcpCommand, args, config.projectRoot), builtins.registry);
  }
  const lspCommand = process.env.CODELOOP_LSP_COMMAND?.trim();
  if (lspCommand) {
    const rawArgs = process.env.CODELOOP_LSP_ARGS?.trim();
    let args: string[] = [];
    if (rawArgs) {
      const parsed: unknown = JSON.parse(rawArgs);
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) throw new Error('CODELOOP_LSP_ARGS must be a JSON string array.');
      args = parsed;
    }
    const transport = new StdioLspTransport(lspCommand, args, config.projectRoot);
    lspClient = new LspClient(transport);
    await transport.request('initialize', { processId: null, rootUri: pathToFileURL(config.projectRoot).href, capabilities: {} });
    transport.notify('initialized', {});
    builtins.registry.register(definitionTool(lspClient));
    builtins.registry.register(referencesTool(lspClient));
  }

  const selectedKey = providerChoice === 'openai' ? process.env.OPENAI_API_KEY : process.env.NVIDIA_API_KEY;
  if (!selectedKey) {
    console.error(`No key is set for the selected provider '${providerChoice}'.`);
    process.exitCode = 2;
    await optionalServers.close();
    return;
  }

  const loop = new AgentLoop(config, provider, builtins.registry, builtins.pathGuard, builtins.permissionPolicy);
  const session = newSession(config.projectRoot);
  const sessionStore = new JsonlSessionStore(config.sessionRoot);
  const readline = createInterface({ input, output });
  let conversation: LlmMessage[] = [];
  console.log(`CodeLoop ${provider.name} session. Type /quit to exit.`);
  try {
    while (true) {
      const prompt = (await readline.question('\n> ')).trim();
      if (!prompt) continue;
      if (prompt === '/quit' || prompt === '/exit') break;
      if (prompt === '/help') {
        console.log('Enter a coding task. Risky actions require confirmation.');
        console.log('/clear starts a new session context. /history shows saved events. /compact saves a context checkpoint.');
        continue;
      }
      if (prompt === '/clear') {
        conversation = [];
        console.log('Conversation context cleared.');
        continue;
      }
      if (prompt === '/history') {
        console.log(`Saved events: ${sessionStore.read(session.id).length}`);
        continue;
      }
      if (prompt === '/compact') {
        sessionStore.append(event(session.id, 'reduction', { reason: 'user-requested checkpoint' }));
        console.log('Context checkpoint saved.');
        continue;
      }
      sessionStore.append(event(session.id, 'user', { text: redactSecrets(prompt) }));
      const result = await loop.run(prompt, {
        onText: (text) => { console.log(text); sessionStore.append(event(session.id, 'assistant', { text: redactSecrets(text) })); },
        onToolCall: (call) => { console.log(`→ ${call.name}`); sessionStore.append(event(session.id, 'tool_call', { name: call.name, arguments: call.arguments })); },
        onToolResult: (call, toolResult) => { console.log(toolResult.ok ? '  ✓ tool completed' : `  ✗ ${toolResult.content}`); sessionStore.append(event(session.id, 'tool_result', { name: call.name, ok: toolResult.ok, content: redactSecrets(toolResult.content) })); },
        approve: async (request) => {
          const answer = (await readline.question(`Allow ${request.action} ${request.target}? [y/N] `)).trim().toLowerCase();
          sessionStore.append(event(session.id, 'permission', { action: request.action, target: request.target, approved: answer === 'y' || answer === 'yes' }));
          return answer === 'y' || answer === 'yes';
        },
      }, undefined, conversation);
      conversation = result.messages;
      console.log(`\nCompleted in ${result.steps} steps.`);
    }
  } finally {
    readline.close();
    await optionalServers.close();
    await lspClient?.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
