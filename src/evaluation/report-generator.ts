import type { EvaluationResult } from './types';
import { median, percentile } from './metrics';

export interface EvaluationReport {
  taskCount: number;
  validCount: number;
  passedCount: number;
  successRate: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  medianSteps: number;
  totalTokens: number;
  totalCostUsd?: number;
}

export function report(results: EvaluationResult[]): EvaluationReport {
  const valid = results.filter((result) => result.valid);
  const costs = valid.map((result) => result.estimatedCostUsd).filter((value): value is number => value !== undefined);
  return {
    taskCount: results.length,
    validCount: valid.length,
    passedCount: valid.filter((result) => result.passed).length,
    successRate: valid.length ? valid.filter((result) => result.passed).length / valid.length : 0,
    medianLatencyMs: median(valid.map((result) => result.durationMs)),
    p95LatencyMs: percentile(valid.map((result) => result.durationMs), 95),
    medianSteps: median(valid.map((result) => result.steps)),
    totalTokens: valid.reduce((total, result) => total + result.totalTokens, 0),
    ...(costs.length ? { totalCostUsd: costs.reduce((total, value) => total + value, 0) } : {}),
  };
}
