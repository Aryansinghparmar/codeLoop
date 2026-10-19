import { CodeLoopError } from '../shared/errors';
import type { LlmUsage } from './provider';

export interface ProviderPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  source: string;
  checkedAt: string;
}

// USD per 1M tokens. Budget caps depend on this table: a model missing here must fail loudly, never cost $0.
export const providerPrices: Readonly<Record<string, ProviderPrice>> = {
  // Source: OpenAI's API pricing page, checked 2026-10-19 (an aggregator had listed $0.20/$1.00; the official page says $0.10/$0.50).
  'gpt-6-luna': { inputPerMillion: 0.1, outputPerMillion: 0.5, source: 'OpenAI API pricing page (developers.openai.com/api/docs/pricing), standard tier; cached input $0.01/1M not modelled', checkedAt: '2026-10-19' },
  // Kept so the historical eval results (run on this model) can still be costed.
  'gpt-5.6-luna': { inputPerMillion: 0.2, outputPerMillion: 1.2, source: 'OpenAI model documentation', checkedAt: '2026-08-14' },
};

// The API may report a dated snapshot (e.g. "gpt-6-luna-2026-09-01"); it is billed like its base model.
export function findProviderPrice(model: string): ProviderPrice | undefined {
  return providerPrices[model] ?? providerPrices[model.replace(/-\d{4}-\d{2}-\d{2}$/u, '')];
}

export function requireProviderPrice(model: string): ProviderPrice {
  const price = findProviderPrice(model);
  if (!price) {
    throw new CodeLoopError('CONFIG_ERROR', `No price for model ${model}; add it to src/llm/pricing.ts so budget caps work.`, { model });
  }
  return price;
}

export function estimateProviderCost(provider: string, model: string, usage: LlmUsage): number | undefined {
  // Offline providers (mock, scripted) cost nothing and have no price.
  if (provider !== 'openai') return undefined;
  const price = requireProviderPrice(model);
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  return (usage.inputTokens / 1_000_000) * price.inputPerMillion + (usage.outputTokens / 1_000_000) * price.outputPerMillion;
}
