import { describe, expect, test } from 'bun:test';
import { createConfig } from '../../src/config/config';
import { EvaluationRunner } from '../../src/evaluation/runner';
import { summarize, formatSummary } from '../../src/evaluation/summarize';
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

/** Keeps calling a tool forever, so the loop stops at maxSteps. */
const neverStops: LlmProvider = {
  name: 'mock-busy',
  async complete(request) {
    const index = request.messages.length;
    return { text: '', toolCalls: [{ id: `ls-${index}`, name: 'shell', arguments: { command: 'ls' } }], usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 }, provider: 'mock-busy', model: 'busy' };
  },
};

const failingProvider: LlmProvider = {
  name: 'mock-down',
  async complete() {
    throw new Error('provider is down');
  },
};

describe('evaluation suite budget', () => {
  test('a run stopped by the task budget is still graded, and later tasks are skipped explicitly', async () => {
    const config = { ...createConfig(), projectRoot: process.cwd(), liveTaskBudgetUsd: 2, liveSuiteBudgetUsd: 1 };
    const results = await new EvaluationRunner(config).run(expensiveProvider, tasks);
    expect(results).toHaveLength(2);
    // The $1.20 call goes over the $1 left in the suite budget, so the loop stops. The work is graded anyway.
    expect(results[0]).toMatchObject({ stopReason: 'task-budget', valid: true, passed: true, assertionsPassed: true, totalTokens: 6_000_000 });
    expect(results[1]).toMatchObject({ stopReason: 'suite-budget-skip', valid: false, passed: false, model: 'not-started' });
    expect(results[1]?.error).toContain('suite budget');
    const summary = summarize([{ label: 'r1', results }]);
    expect(summary.stopReasons).toEqual({ 'task-budget': 1, 'suite-budget-skip': 1 });
    expect(summary.passMatrix.rows.B2).toEqual(['skipped']);
    expect(summary.perTask.find((row) => row.taskId === 'B2')?.skipped).toBe(1);
    expect(summary.passAtK.pass1).toBe(0.5);
    expect(formatSummary(summary)).toContain('WARNING: 1 runs were skipped by the suite budget');
  });
});

describe('runner stop reasons', () => {
  test('a run that hits the step limit is graded and valid, with its tokens counted', async () => {
    const config = { ...createConfig(), maxSteps: 3 };
    const [result] = await new EvaluationRunner(config).run(neverStops, [tasks[0]!]);
    expect(result).toMatchObject({ stopReason: 'step-limit', valid: true, passed: true, steps: 3, totalTokens: 30 });
    expect(result?.assertionDetails[0]).toContain('run stopped');
    expect(summarize([{ label: 'r', results: result ? [result] : [] }]).pooled.totalTokens).toBe(30);
  });

  test('a provider failure is an invalid row with stopReason error', async () => {
    const [result] = await new EvaluationRunner(createConfig()).run(failingProvider, [tasks[0]!]);
    expect(result).toMatchObject({ stopReason: 'error', valid: false, passed: false });
    expect(result?.error).toContain('provider is down');
  });

  test('live rows record the suite, the category and the step limit', async () => {
    const task = { ...tasks[0]!, category: 'bugfix' };
    const done: LlmProvider = { name: 'mock-done', async complete() { return { text: 'done', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: 'mock-done', model: 'done' }; } };
    const [result] = await new EvaluationRunner({ ...createConfig(), maxSteps: 40 }).run(done, [task], undefined, { suite: 'v2' });
    expect(result).toMatchObject({ suite: 'v2', category: 'bugfix', maxSteps: 40, stopReason: 'completed' });
  });
});
