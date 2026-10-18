import { estimateProviderCost } from '../llm/pricing';
import type { LlmResponse } from '../llm/provider';

/** Counters for one AgentLoop.run(), reported on success and copied into CodeLoopError.details on failure. */
export interface RunStats {
  startedAt: number;
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  recoveredFailures: number;
  reductions: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCostUsd: number | undefined;
  lastResponse: { provider: string; model: string };
}

export function createRunStats(providerName: string): RunStats {
  return {
    startedAt: Date.now(),
    steps: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    recoveredFailures: 0,
    reductions: 0,
    estimatedCostUsd: undefined,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastResponse: { provider: providerName, model: 'unknown' },
  };
}

/** Adds one model response's API-reported token usage to the totals and re-estimates the run's cost. */
export function recordResponse(stats: RunStats, response: LlmResponse): void {
  const input = response.usage.inputTokens ?? 0;
  const output = response.usage.outputTokens ?? 0;
  stats.lastResponse = { provider: response.provider, model: response.model };
  stats.usage.inputTokens += input;
  stats.usage.outputTokens += output;
  stats.usage.totalTokens += response.usage.totalTokens ?? (input + output);
  stats.estimatedCostUsd = estimateProviderCost(response.provider, response.model, { ...stats.usage });
}

/** The details keys read by src/evaluation/runner.ts when a run fails. Keep them stable. */
export function statsDetails(stats: RunStats): Record<string, unknown> {
  return {
    provider: stats.lastResponse.provider,
    model: stats.lastResponse.model,
    durationMs: Date.now() - stats.startedAt,
    steps: stats.steps,
    toolCalls: stats.toolCalls,
    failedToolCalls: stats.failedToolCalls,
    recoveredFailures: stats.recoveredFailures,
    reductions: stats.reductions,
    inputTokens: stats.usage.inputTokens,
    outputTokens: stats.usage.outputTokens,
    totalTokens: stats.usage.totalTokens,
    ...(stats.estimatedCostUsd !== undefined ? { estimatedCostUsd: stats.estimatedCostUsd } : {}),
  };
}
