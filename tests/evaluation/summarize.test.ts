import { describe, expect, test } from 'bun:test';
import { binomialUpperTail, buildRepeatedSummary, clopperPearsonLower, summarize, STAT_METHOD } from '../../src/evaluation/summarize';
import { agentRanTests } from '../../src/evaluation/trace-analysis';
import type { EvaluationResult } from '../../src/evaluation/types';

function row(taskId: string, durationMs: number, passed: boolean, toolTrace: string[], extra: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    taskId, provider: 'openai', model: 'test-model', passed, valid: true, durationMs, steps: 2,
    toolCalls: toolTrace.filter((entry) => entry.startsWith('call ')).length,
    failedToolCalls: toolTrace.filter((entry) => entry.startsWith('fail ')).length,
    recoveredFailures: 0, reductions: 0, inputTokens: 10, outputTokens: 5, totalTokens: 15,
    estimatedCostUsd: 0.25, assertionDetails: [], toolTrace, ...extra,
  };
}

const ranTest = ['call shell {"command":"bun test tests/a.test.ts"}', 'ok shell: {"stdout":"1 pass"}'];
const rejected = ['call shell {"command":"npm test"}', 'fail shell: Shell command rejected by the user.'];
const rejectedNewWording = ['call shell {"command":"npm test"}', 'fail shell: Shell rejected by the user.'];
const failedTest = ['call shell {"command":"bun test"}', 'fail shell: {"exitCode":1}'];

const runs = [
  { label: 'repeat-1', results: [row('T1', 1000, true, ranTest), row('T2', 3000, false, rejectedNewWording)] },
  { label: 'repeat-2', results: [row('T1', 2000, true, [...rejected, ...ranTest], { reductions: 1 }), row('T2', 4000, true, failedTest)] },
];

describe('evaluation summariser', () => {
  test('pools latency across runs with the documented method', () => {
    const summary = summarize(runs);
    expect(summary.statMethod).toBe(STAT_METHOD);
    expect(summary.pooled.taskCount).toBe(4);
    expect(summary.pooled.passedCount).toBe(3);
    expect(summary.pooled.medianLatencyMs).toBe(2500);
    expect(summary.pooled.p95LatencyMs).toBe(4000);
    expect(summary.pooled.p95Rank).toBe('4/4');
    expect(summary.perRun.map((run) => run.report.medianLatencyMs)).toEqual([2000, 3000]);
    expect(summary.totalEstimatedCostUsd).toBe(1);
  });

  test('builds a task by repeat pass matrix', () => {
    expect(summarize(runs).passMatrix).toEqual({ columns: ['repeat-1', 'repeat-2'], rows: { T1: ['pass', 'pass'], T2: ['fail', 'pass'] } });
  });

  test('reads test execution, rejections and compaction from the trace', () => {
    expect(summarize(runs).traceStats).toEqual({
      runs: 4,
      runsThatAttemptedTests: 4,
      runsThatExecutedTests: 2,
      toolCalls: 5,
      failedToolCalls: 3,
      autoRejectedShellCalls: 2,
      compactionReductions: 1,
      runsWithCompaction: 1,
    });
    expect(agentRanTests(failedTest)).toBe(false);
  });

  test('computes pass@1, pass@k and pass^k per task', () => {
    // T1 passes in both repeats, T2 in one of two.
    expect(summarize(runs).passAtK).toMatchObject({ k: 2, tasks: 2, pass1: 0.75, passAtK: 1, passHatK: 0.5 });
    const threeRuns = [
      { label: 'r1', results: [row('A', 1, true, []), row('B', 1, false, []), row('C', 1, false, [])] },
      { label: 'r2', results: [row('A', 1, true, []), row('B', 1, true, []), row('C', 1, false, [], { valid: false })] },
      // C is missing from r3: it counts as a failure there.
      { label: 'r3', results: [row('A', 1, true, []), row('B', 1, false, [])] },
    ];
    const metrics = summarize(threeRuns).passAtK;
    expect(metrics).toMatchObject({ k: 3, tasks: 3, passAtK: 2 / 3, passHatK: 1 / 3 });
    expect(metrics.pass1).toBeCloseTo((1 + 1 / 3 + 0) / 3, 12);
  });

  test('lists every task with its passes, invalid runs and compaction', () => {
    const table = summarize(runs).perTask;
    expect(table).toEqual([
      { taskId: 'T1', runs: 2, passes: 2, passRate: 1, invalid: 0, runsWithCompaction: 1, skipped: 0, agentStopped: 0, medianSteps: 2, meanCostUsd: 0.25 },
      { taskId: 'T2', runs: 2, passes: 1, passRate: 0.5, invalid: 0, runsWithCompaction: 0, skipped: 0, agentStopped: 0, medianSteps: 2, meanCostUsd: 0.25 },
    ]);
  });

  test('reports the pass rate of compacted runs separately', () => {
    expect(summarize(runs).compaction).toEqual({
      runsWithCompaction: 1, passedWithCompaction: 1, passRateWithCompaction: 1,
      runsWithoutCompaction: 3, passedWithoutCompaction: 2, passRateWithoutCompaction: 2 / 3,
    });
    const none = summarize([{ label: 'r', results: [row('T1', 1, true, [])] }]).compaction;
    expect(none.passRateWithCompaction).toBeNull();
    const invalidCompacted = summarize([{ label: 'r', results: [row('T1', 1, true, [], { reductions: 2, valid: false })] }]).compaction;
    expect(invalidCompacted).toMatchObject({ runsWithCompaction: 1, passedWithCompaction: 0, passRateWithCompaction: 0 });
  });

  test('counts stop reasons, labels old invalid rows, and compares compaction within each category', () => {
    const rows = [
      row('V15', 1, true, [], { category: 'long-context', reductions: 2, stopReason: 'completed', maxSteps: 40 }),
      row('V15', 1, false, [], { category: 'long-context', reductions: 3, stopReason: 'step-limit', maxSteps: 40 }),
      row('V01', 1, true, [], { category: 'bugfix', stopReason: 'completed', maxSteps: 40 }),
      row('V18', 0, false, [], { category: 'safety', valid: false, stopReason: 'suite-budget-skip', model: 'not-started', maxSteps: 40 }),
      row('T9', 1, false, [], { valid: false, error: 'The same tool failure repeated 3 times.' }),
    ];
    const summary = summarize([{ label: 'r1', results: rows }]);
    expect(summary.stopReasons).toEqual({ completed: 2, 'step-limit': 1, 'suite-budget-skip': 1, 'invalid (recorded before stop reasons)': 1 });
    expect(summary.maxSteps).toEqual([40]);
    expect(summary.perCategory).toEqual([
      { category: 'long-context', runs: 2, passed: 1, passRate: 0.5, runsWithCompaction: 2, passedWithCompaction: 1 },
      { category: 'bugfix', runs: 1, passed: 1, passRate: 1, runsWithCompaction: 0, passedWithCompaction: 0 },
      { category: 'safety', runs: 1, passed: 0, passRate: 0, runsWithCompaction: 0, passedWithCompaction: 0 },
    ]);
    expect(summary.perTask.find((item) => item.taskId === 'V15')?.agentStopped).toBe(1);
    const repeated = buildRepeatedSummary({ provider: 'openai', model: 'm', suite: 'v2', startedAt: 'now', taskCount: 4, resultFiles: [], runs: [{ label: 'r1', results: rows }] });
    expect(repeated.reportedModels).toEqual(['test-model']);
  });

  test('records which suites the rows came from (unlabelled rows are v1)', () => {
    expect(summarize(runs).suites).toEqual(['v1']);
    expect(summarize([{ label: 'r', results: [row('V01', 1, true, [], { suite: 'v2' }), row('T1', 1, true, [])] }]).suites).toEqual(['v2', 'v1']);
  });

  test('computes the exact one-sided Clopper-Pearson lower bound', () => {
    const bound = summarize(runs).passRate.lowerBound95;
    expect(bound).toBeCloseTo(0.2486, 4);
    expect(binomialUpperTail(3, 4, bound)).toBeCloseTo(0.05, 9);
    expect(clopperPearsonLower(30, 30)).toBeCloseTo(0.05 ** (1 / 30), 12);
    expect(clopperPearsonLower(30, 30)).toBeCloseTo(0.905, 3);
    expect(clopperPearsonLower(0, 5)).toBe(0);
  });
});
