import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfig, type CodeLoopConfig } from '../../src/config/config';
import { AgentLoop, buildSystemPrompt } from '../../src/agent/agent-loop';
import { MockProvider, textResponse, type MockResponseFactory } from '../../src/llm/mock-provider';
import type { LlmResponse, LlmToolCall } from '../../src/llm/provider';
import { CodeLoopError } from '../../src/shared/errors';
import { createBuiltinRegistry } from '../../src/tools/builtins';
import { assertPairsIntact } from '../context/pairs';
import { temporaryRoot, removeRoot } from '../helpers';

function toolResponse(call: LlmToolCall): LlmResponse {
  return { text: '', toolCalls: [call], usage: { inputTokens: 10, outputTokens: 5 }, provider: 'mock', model: 'mock' };
}

function createLoop(config: CodeLoopConfig, factory: MockResponseFactory): AgentLoop {
  const builtins = createBuiltinRegistry(config);
  return new AgentLoop(config, new MockProvider(factory), builtins.registry, builtins.pathGuard, builtins.permissionPolicy);
}

async function runFailure(loop: AgentLoop, prompt: string): Promise<CodeLoopError> {
  try {
    await loop.run(prompt);
  } catch (error) {
    if (error instanceof CodeLoopError) return error;
    throw error;
  }
  throw new Error('Expected the run to fail.');
}

describe('agent loop', () => {
  test('executes a mock tool call and stops on final text', async () => {
    const root = await temporaryRoot();
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      const provider = new MockProvider((_request, index) => index === 0
        ? Promise.resolve({ text: '', toolCalls: [{ id: 'call-1', name: 'write', arguments: { path: 'src/answer.ts', content: 'export const answer = 42;\n' } }], usage: {}, provider: 'mock', model: 'mock' })
        : Promise.resolve(textResponse('Done.')));
      const config = createConfig(root);
      const builtins = createBuiltinRegistry(config);
      const loop = new AgentLoop(config, provider, builtins.registry, builtins.pathGuard, builtins.permissionPolicy);
      const result = await loop.run('Create the answer file.');
      expect(result.text).toBe('Done.');
      expect(result.toolCalls).toBe(1);
      expect(await readFile(join(root, 'src', 'answer.ts'), 'utf8')).toContain('42');
    } finally { await removeRoot(root); }
  });

  test('still completes with a tiny context budget, and every request keeps call/output pairs', async () => {
    const root = await temporaryRoot();
    try {
      await writeFile(join(root, 'big.txt'), 'some file content line\n'.repeat(300), 'utf8');
      const config: CodeLoopConfig = { ...createConfig(root), contextBudgetTokens: 2_000 };
      const loop = createLoop(config, (request, index) => {
        assertPairsIntact(request.messages);
        expect(request.messages.some((message) => message.content === 'Read big.txt several times.')).toBe(true);
        return index < 5 ? toolResponse({ id: `read-${index}`, name: 'read', arguments: { path: 'big.txt' } }) : textResponse('Done.');
      });
      const result = await loop.run('Read big.txt several times.');
      expect(result.text).toBe('Done.');
      expect(result.toolCalls).toBe(5);
      expect(result.reductions).toBeGreaterThan(0);
    } finally { await removeRoot(root); }
  });

  test('step limit failure keeps the details keys the evaluation runner reads', async () => {
    const root = await temporaryRoot();
    try {
      await writeFile(join(root, 'a.txt'), 'hello\n', 'utf8');
      const config: CodeLoopConfig = { ...createConfig(root), maxSteps: 2 };
      const loop = createLoop(config, (_request, index) => toolResponse({ id: `read-${index}`, name: 'read', arguments: { path: 'a.txt' } }));
      const error = await runFailure(loop, 'Keep reading.');
      expect(error.code).toBe('STEP_LIMIT');
      expect(Object.keys(error.details).sort()).toEqual([
        'durationMs', 'failedToolCalls', 'inputTokens', 'model', 'outputTokens', 'provider',
        'recoveredFailures', 'reductions', 'steps', 'stopReason', 'toolCalls', 'totalTokens',
      ]);
      expect(error.details).toMatchObject({ stopReason: 'step-limit', provider: 'mock', model: 'mock', steps: 2, toolCalls: 2, failedToolCalls: 0, inputTokens: 20, outputTokens: 10, totalTokens: 30 });
    } finally { await removeRoot(root); }
  });

  test('tool arguments marked __invalidJson return an error tool result instead of running the tool', async () => {
    const root = await temporaryRoot();
    try {
      const config = createConfig(root);
      const loop = createLoop(config, (_request, index) => index === 0
        ? toolResponse({ id: 'bad-1', name: 'write', arguments: { __invalidJson: '{"path": "x.txt", "content": ' } })
        : textResponse('Recovered.'));
      const result = await loop.run('Write a file.');
      expect(result.text).toBe('Recovered.');
      expect(result.failedToolCalls).toBe(1);
      const toolMessage = result.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.toolCallId).toBe('bad-1');
      expect(toolMessage?.content).toContain('not valid JSON');
      expect(await Bun.file(join(root, 'x.txt')).exists()).toBe(false);
    } finally { await removeRoot(root); }
  });

  test('system prompt names the OS, shell, project root, date and test runner', () => {
    const windows = buildSystemPrompt('C:\\repo', 'win32', new Date('2026-10-18T12:00:00Z'));
    expect(windows).toContain('win32');
    expect(windows).toContain('PowerShell');
    expect(windows).toContain('C:\\repo');
    expect(windows).toContain('2026-10-18');
    expect(windows).toContain('`bun test`');
    expect(windows).toContain('denied');
    expect(buildSystemPrompt('/repo', 'linux')).toContain('run in sh');
    expect(windows.split('\n').length).toBeLessThanOrEqual(20);
  });

  // From the v2 root-cause analysis: the model gave up after refusals and ignored nextStartLine.
  test('system prompt points to list/grep, paging and verifying, and says a refusal is not the end', () => {
    const prompt = buildSystemPrompt('C:\\repo', 'win32');
    expect(prompt).toContain('Use list to find files and grep to search code');
    expect(prompt).toContain('nextStartLine');
    expect(prompt).toContain('A refused command is not the end of the task');
    expect(prompt).toContain('run `bun test` to verify');
    expect(prompt).not.toContain('explain why you cannot continue');
  });

  test('the same tool failure three times in a row stops the run', async () => {
    const root = await temporaryRoot();
    try {
      const config = createConfig(root);
      const loop = createLoop(config, (_request, index) => toolResponse({ id: `read-${index}`, name: 'read', arguments: { path: 'missing.txt' } }));
      const error = await runFailure(loop, 'Read the missing file.');
      expect(error.code).toBe('TOOL_ERROR');
      expect(error.details).toMatchObject({ tool: 'read', steps: 3, toolCalls: 3, failedToolCalls: 3, recoveredFailures: 0 });
    } finally { await removeRoot(root); }
  });
});
