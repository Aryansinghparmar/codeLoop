import type { LlmUsage } from '../llm/provider';
import { estimateProviderCost } from '../llm/pricing';

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  source: string;
  checkedAt: string;
}

export function calculateCost(provider: string, model: string, usage: LlmUsage): { costUsd?: number; price?: ModelPrice } {
  const costUsd = estimateProviderCost(provider, model, usage);
  if (costUsd === undefined) return {};
  const price: ModelPrice | undefined = model === 'gpt-5.6-luna' ? { inputPerMillion: 0.2, outputPerMillion: 1.2, source: 'OpenAI model documentation', checkedAt: '2026-08-14' } : undefined;
  if (!price) return { costUsd };
  return {
    price,
    costUsd,
  };
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
