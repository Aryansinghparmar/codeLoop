import { describe, expect, test } from 'bun:test';
import { createConfig } from '../../src/config/config';
import { EvaluationRunner } from '../../src/evaluation/runner';
import { fixedTasks } from '../../src/evaluation/fixed-tasks';
import { reportsExactPasses } from '../../src/evaluation/grader';
import { NativeProcessRunner } from '../../src/infrastructure/process/native-process-runner';
import type { LlmProvider, LlmToolCall } from '../../src/llm/provider';
import { ScriptedProvider } from '../../src/llm/scripted-provider';

/** Plays back fixed tool calls, one per step, then stops. */
function scriptedEdits(calls: LlmToolCall[]): LlmProvider {
  return {
    name: 'mock-scripted',
    async complete(request) {
      const done = request.messages.filter((message) => message.role === 'tool').length;
      const next = calls[done];
      return { text: next ? '' : 'done', toolCalls: next ? [next] : [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: 'mock-scripted', model: 'scripted-model' };
    },
  };
}

const countTask = fixedTasks.filter((task) => task.id === 'T3');
const graderRunner = new NativeProcessRunner();

describe('test-executing grader', () => {
  test('passes a correct fix only after really running bun test', async () => {
    const [result] = await new EvaluationRunner(createConfig()).run(new ScriptedProvider(), countTask, undefined, { graderRunner });
    expect(result?.testsExecuted).toBe(true);
    expect(result?.testsPassed).toBe(true);
    expect(result?.assertionsPassed).toBe(true);
    expect(result?.passed).toBe(true);
  }, 60_000);

  test('fails a wrong fix that the old substring check would have passed', async () => {
    // Contains the string 'i + 1' (the old T3 check) but still returns [0, 1, 2].
    const wrongFix = scriptedEdits([{ id: 'w1', name: 'edit', arguments: { path: 'src/count.ts', oldText: '(_, i) => i)', newText: '(_, i) => i + 1 - 1)' } }]);
    const [result] = await new EvaluationRunner(createConfig()).run(wrongFix, countTask, undefined, { graderRunner });
    expect(result?.valid).toBe(true);
    expect(result?.assertionsPassed).toBe(true);
    expect(result?.testsExecuted).toBe(true);
    expect(result?.testsPassed).toBe(false);
    expect(result?.passed).toBe(false);
    expect(result?.agentRanTests).toBe(false);
  }, 60_000);

  test('says so when the offline suite does not execute tests', async () => {
    const [result] = await new EvaluationRunner(createConfig()).run(new ScriptedProvider(), countTask);
    expect(result?.testsExecuted).toBe(false);
    expect(result?.testsPassed).toBeUndefined();
    expect(result?.assertionDetails).toContain('grader tests not executed (offline run)');
  });
});

describe('grader pass count', () => {
  test('requires exactly the expected passes and no failures', () => {
    const summary = 'tests/grader-check.test.ts:\n(pass) a\n(pass) b\n\n 2 pass\n 0 fail\nRan 2 tests across 1 file.';
    expect(reportsExactPasses(summary, 2)).toBe(true);
    expect(reportsExactPasses(summary, 3)).toBe(false);
    expect(reportsExactPasses(' 2 pass\n 1 fail\n', 2)).toBe(false);
    // A module that calls process.exit(0) leaves no summary at all.
    expect(reportsExactPasses('bun test v1.3.10\n', 2)).toBe(false);
  });
});
