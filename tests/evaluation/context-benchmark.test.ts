import { describe, expect, test } from 'bun:test';
import { runContextBenchmark } from '../../src/evaluation/context-benchmark';

describe('context benchmark', () => {
  test('compacts a large tool-result history under the configured budget', () => {
    const result = runContextBenchmark();
    expect(result.reduced).toBe(true);
    expect(result.beforeTokens).toBeGreaterThan(result.contextBudgetTokens);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    expect(result.reductionPercent).toBeGreaterThan(0);
    expect(result.messageCountAfter).toBeLessThan(result.messageCountBefore);
  });
});
