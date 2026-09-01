import type { LlmUsage } from './provider';

export interface ProviderPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const prices: Record<string, ProviderPrice> = {
  'gpt-5.6-luna': { inputPerMillion: 0.2, outputPerMillion: 1.2 },
};

export function estimateProviderCost(provider: string, model: string, usage: LlmUsage): number | undefined {
  if (provider !== 'openai') return undefined;
  const price = prices[model];
  if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  return (usage.inputTokens / 1_000_000) * price.inputPerMillion + (usage.outputTokens / 1_000_000) * price.outputPerMillion;
}
