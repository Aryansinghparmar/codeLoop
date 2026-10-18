import { describe, expect, test } from 'bun:test';
import { binomialUpperTail, clopperPearsonLower, summarize, STAT_METHOD } from '../../src/evaluation/summarize';
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

  test('computes the exact one-sided Clopper-Pearson lower bound', () => {
    const bound = summarize(runs).passRate.lowerBound95;
    expect(bound).toBeCloseTo(0.2486, 4);
    expect(binomialUpperTail(3, 4, bound)).toBeCloseTo(0.05, 9);
    expect(clopperPearsonLower(30, 30)).toBeCloseTo(0.05 ** (1 / 30), 12);
    expect(clopperPearsonLower(30, 30)).toBeCloseTo(0.905, 3);
    expect(clopperPearsonLower(0, 5)).toBe(0);
  });
});
