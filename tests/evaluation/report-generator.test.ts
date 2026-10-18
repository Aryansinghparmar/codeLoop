import { describe, expect, test } from 'bun:test';
import { report } from '../../src/evaluation/report-generator';
import type { EvaluationResult } from '../../src/evaluation/types';

function row(durationMs: number, passed: boolean, valid: boolean): EvaluationResult {
  return {
    taskId: 'T1', provider: 'openai', model: 'test-model', passed, valid, durationMs, steps: 3,
    toolCalls: 1, failedToolCalls: 0, recoveredFailures: 0, reductions: 0,
    inputTokens: 10, outputTokens: 5, totalTokens: 15, assertionDetails: [],
  };
}

describe('evaluation report', () => {
  test('counts an invalid run as a failure, not as a missing sample', () => {
    const summary = report([row(1000, true, true), row(2000, true, true), row(500, false, false)]);
    expect(summary.taskCount).toBe(3);
    expect(summary.validCount).toBe(2);
    expect(summary.passedCount).toBe(2);
    expect(summary.successRate).toBeCloseTo(2 / 3, 10);
  });

  test('latency is computed over valid runs only', () => {
    const summary = report([row(1000, true, true), row(3000, true, true), row(50, false, false)]);
    expect(summary.medianLatencyMs).toBe(2000);
  });
});
