import { createConfig } from './config/config';
import { loadEnvironment } from './config/env';
import { AgentLoop } from './agent/agent-loop';
import { OpenAiResponsesProvider } from './llm/openai/responses-provider';
import { createBuiltinRegistry } from './tools/builtins';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { JsonlSessionStore } from './session/jsonl-store';
import { event, newSession } from './session/session';
import { redactSecrets } from './shared/redact';
import { CodeLoopError } from './shared/errors';
import type { LlmMessage } from './llm/provider';

async function main(): Promise<void> {
  const projectRoot = process.env.CODELOOP_PROJECT_ROOT ?? process.cwd();
  loadEnvironment(projectRoot);
  const config = createConfig(projectRoot);
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set.');
    process.exitCode = 2;
    return;
  }

  const builtins = createBuiltinRegistry(config);
  const provider = new OpenAiResponsesProvider(config);
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
        console.log('/clear starts a new session context. /history shows saved events. /checkpoint records a marker in the session log.');
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
      if (prompt === '/checkpoint') {
        sessionStore.append(event(session.id, 'reduction', { reason: 'user-requested checkpoint' }));
        console.log('Checkpoint marker saved. Context compaction runs automatically before each model call.');
        continue;
      }
      sessionStore.append(event(session.id, 'user', { text: redactSecrets(prompt) }));
      try {
        const result = await loop.run(prompt, {
          onText: (text) => { console.log(text); sessionStore.append(event(session.id, 'assistant', { text: redactSecrets(text) })); },
          onToolCall: (call) => { console.log(`→ ${call.name}`); sessionStore.append(event(session.id, 'tool_call', { name: call.name, arguments: redactSecrets(JSON.stringify(call.arguments)) })); },
          onToolResult: (call, toolResult) => { console.log(toolResult.ok ? '  ✓ tool completed' : `  ✗ ${toolResult.content}`); sessionStore.append(event(session.id, 'tool_result', { name: call.name, ok: toolResult.ok, content: redactSecrets(toolResult.content) })); },
          approve: async (request) => {
            const answer = (await readline.question(`Allow ${request.action} ${request.target}? [y/N] `)).trim().toLowerCase();
            sessionStore.append(event(session.id, 'permission', { action: request.action, target: request.target, approved: answer === 'y' || answer === 'yes' }));
            return answer === 'y' || answer === 'yes';
          },
        }, undefined, conversation);
        conversation = result.messages;
        console.log(`\nCompleted in ${result.steps} steps.`);
      } catch (error) {
        // A failed run (step limit, budget, provider outage) ends that task, not the whole session.
        const message = error instanceof CodeLoopError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
        console.error(`\nRun stopped. ${message}`);
        sessionStore.append(event(session.id, 'error', { message: redactSecrets(message) }));
      }
    }
  } finally {
    readline.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
