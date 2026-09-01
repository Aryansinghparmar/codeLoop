import { describe, expect, test } from 'bun:test';
import { createConfig } from '../../src/config/config';
import { EvaluationRunner } from '../../src/evaluation/runner';
import type { BenchmarkTask } from '../../src/evaluation/types';
import type { LlmProvider } from '../../src/llm/provider';

const tasks: BenchmarkTask[] = [
  { id: 'B1', name: 'budget-one', live: true, prompt: 'complete task one', async setup() {}, async assert() { return { passed: true, details: ['done'] }; } },
  { id: 'B2', name: 'budget-two', live: true, prompt: 'complete task two', async setup() {}, async assert() { return { passed: true, details: ['done'] }; } },
];

const expensiveProvider: LlmProvider = {
  name: 'openai',
  async complete() {
    return { text: 'done', toolCalls: [], usage: { inputTokens: 6_000_000, outputTokens: 0, totalTokens: 6_000_000 }, provider: 'openai', model: 'gpt-5.6-luna' };
  },
};

describe('evaluation suite budget', () => {
  test('does not start tasks after the suite budget is reached', async () => {
    const config = { ...createConfig(), projectRoot: process.cwd(), liveTaskBudgetUsd: 2, liveSuiteBudgetUsd: 1 };
    const results = await new EvaluationRunner(config).run(expensiveProvider, tasks);
    expect(results).toHaveLength(2);
    expect(results[0]?.valid).toBe(false);
    expect(results[1]?.error).toContain('suite budget');
  });
});
