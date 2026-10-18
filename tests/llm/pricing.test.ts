import { describe, expect, test } from 'bun:test';
import { estimateProviderCost, findProviderPrice, providerPrices } from '../../src/llm/pricing';
import { CodeLoopError } from '../../src/shared/errors';

describe('provider pricing', () => {
  test('costs gpt-6-luna at $0.10 in / $0.50 out per million tokens', () => {
    expect(estimateProviderCost('openai', 'gpt-6-luna', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6, 10);
    expect(estimateProviderCost('openai', 'gpt-6-luna', { inputTokens: 20_000, outputTokens: 2_000 })).toBeCloseTo(0.003, 10);
  });

  test('keeps the historical gpt-5.6-luna price for old eval data', () => {
    expect(estimateProviderCost('openai', 'gpt-5.6-luna', { inputTokens: 1_000_000, outputTokens: 500_000 })).toBeCloseTo(0.8, 10);
    expect(providerPrices['gpt-5.6-luna']?.checkedAt).toBe('2026-08-14');
  });

  test('prices a dated snapshot like its base model', () => {
    expect(findProviderPrice('gpt-6-luna-2026-09-01')).toBe(providerPrices['gpt-6-luna']);
  });

  test('throws CONFIG_ERROR for an unpriced OpenAI model instead of reporting $0', () => {
    let caught: unknown;
    try {
      estimateProviderCost('openai', 'gpt-unknown', { inputTokens: 10, outputTokens: 10 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodeLoopError);
    expect((caught as CodeLoopError).code).toBe('CONFIG_ERROR');
    expect((caught as CodeLoopError).message).toContain('gpt-unknown');
  });

  test('offline providers have no cost', () => {
    expect(estimateProviderCost('mock-scripted', 'scripted-model', { inputTokens: 100, outputTokens: 20 })).toBeUndefined();
  });
});
