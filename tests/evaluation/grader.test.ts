import { describe, expect, test } from 'bun:test';
import { createConfig } from '../../src/config/config';
import { EvaluationRunner } from '../../src/evaluation/runner';
import { fixedTasks } from '../../src/evaluation/fixed-tasks';
import { judgeJUnit, parseJUnit, runGraderTests } from '../../src/evaluation/grader';
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

describe('grader JUnit verdict', () => {
  const report = (cases: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="t">${cases}</testsuite></testsuites>`;
  const pass = (name: string) => `<testcase name="${name}" classname="" time="0" />`;

  test('reads names (with XML escapes) and failures', () => {
    expect(parseJUnit(report(`${pass('grader: a &quot;b&quot; &lt;c&gt;')}<testcase name="grader: d"><failure type="AssertionError" /></testcase><testcase name="grader: e"><skipped /></testcase>`))).toEqual([
      { name: 'grader: a "b" <c>', passed: true },
      { name: 'grader: d', passed: false },
      { name: 'grader: e', passed: false },
    ]);
  });

  test('requires exactly the expected names, each passed', () => {
    expect(judgeJUnit(report(pass('grader: a') + pass('grader: b')), ['grader: a', 'grader: b']).ok).toBe(true);
    expect(judgeJUnit(report(pass('grader: a')), ['grader: a', 'grader: b']).problem).toContain('missing');
    expect(judgeJUnit(report(pass('grader: a') + pass('grader: b') + pass('extra')), ['grader: a', 'grader: b']).problem).toContain('unexpected');
    expect(judgeJUnit(report(pass('grader: a') + pass('grader: a')), ['grader: a']).ok).toBe(false);
    expect(judgeJUnit(report(`${pass('grader: a')}<testcase name="grader: b"><failure /></testcase>`), ['grader: a', 'grader: b']).problem).toContain('not passed');
    // A module that calls process.exit(0) stops bun before it writes the report.
    expect(judgeJUnit(undefined, ['grader: a']).problem).toContain('no JUnit report');
  });
});

describe('grader robustness', () => {
  test('a directory at the grader test path is replaced, not a crash', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'grader-dir-'));
    try {
      mkdirSync(join(root, 'tests', 'grader-check.test.ts'), { recursive: true });
      writeFileSync(join(root, 'tests', 'grader-check.test.ts', 'keep.txt'), 'x');
      const { testFile: _visibleTest, ...base } = countTask[0]!;
      const task = { ...base, graderTest: "import { test, expect } from 'bun:test';\ntest('ok', () => expect(1).toBe(1));\n" };
      const result = await runGraderTests(task, root, graderRunner);
      expect(result.testsExecuted).toBe(true);
      expect(result.testsPassed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
