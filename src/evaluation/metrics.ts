import type { LlmUsage } from '../llm/provider';
import { estimateProviderCost } from '../llm/pricing';

/** Cost comes from the single price table in ../llm/pricing; undefined when the model has no known price. */
export function calculateCost(provider: string, model: string, usage: LlmUsage): { costUsd?: number } {
  const costUsd = estimateProviderCost(provider, model, usage);
  return costUsd === undefined ? {} : { costUsd };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}
