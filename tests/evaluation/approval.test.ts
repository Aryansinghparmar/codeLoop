import { describe, expect, test } from 'bun:test';
import { approveEvalRequest, isEvalApproved } from '../../src/evaluation/approval';
import { createConfig } from '../../src/config/config';
import { EvaluationRunner } from '../../src/evaluation/runner';
import type { BenchmarkTask } from '../../src/evaluation/types';
import type { LlmProvider } from '../../src/llm/provider';

const shell = (target: string) => ({ action: 'shell' as const, target });

describe('evaluation approval callback', () => {
  test('approves bun test with optional relative test files', () => {
    expect(isEvalApproved(shell('bun test'))).toBe(true);
    expect(isEvalApproved(shell('bun test tests/a.test.ts'))).toBe(true);
    expect(isEvalApproved(shell('bun test ./tests/a.test.ts tests\\b.test.ts'))).toBe(true);
  });

  test('rejects everything else', () => {
    for (const command of [
      'bun test ../x',
      'bun test tests/../../x',
      'bun test --preload x',
      'bun test -t name',
      'bun test && rm x',
      'bun test; rm x',
      'bun test | more',
      'bun test\nrm x',
      'bun test tests/a.test.ts\nrm x',
      'bun test /etc/x.test.ts',
      'bun test C:\\x.test.ts',
      'bun test $(whoami)',
      'bun test `whoami`',
      'bun install',
      'bunx test',
      'npm test',
      'node x.js',
      '',
    ]) expect({ command, approved: isEvalApproved(shell(command)) }).toEqual({ command, approved: false });
  });

  test('never approves non-shell actions', async () => {
    expect(await approveEvalRequest({ action: 'write', target: 'bun test' })).toBe(false);
    expect(await approveEvalRequest({ action: 'edit', target: 'src/a.ts' })).toBe(false);
  });

  test('the runner hands this callback to the agent', async () => {
    const asked: string[] = [];
    const commands = ['bun test tests/a.test.ts', 'npm test'];
    const provider: LlmProvider = {
      name: 'mock-scripted',
      async complete(request) {
        const done = request.messages.filter((message) => message.role === 'tool').length;
        const command = commands[done];
        const toolCalls = command ? [{ id: `c${done}`, name: 'shell', arguments: { command } }] : [];
        return { text: command ? '' : 'done', toolCalls, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: 'mock-scripted', model: 'scripted-model' };
      },
    };
    const task: BenchmarkTask = { id: 'A1', name: 'approval', live: false, prompt: 'run tests', async setup() {}, async assert() { return { passed: true, details: [] }; } };
    // `npm test` is confirm-tier and must be rejected; `bun test` must run whether it is
    // allow-listed or confirm-tier (then this callback approves it).
    const fakeRunner = { async run(command: string) { asked.push(command); return { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, durationMs: 1 }; } };
    const [result] = await new EvaluationRunner(createConfig()).run(provider, [task], fakeRunner);
    expect(result?.toolTrace?.[1]).toStartWith('ok shell');
    expect(result?.toolTrace?.[3]).toMatch(/^fail shell: .*rejected/iu);
    expect(asked).toEqual(['bun test tests/a.test.ts']);
  });
});
