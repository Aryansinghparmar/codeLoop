import { describe, expect, test } from 'bun:test';
import { createConfig } from '../../src/config/config';
import { ScriptedCodingProvider } from '../../src/llm/scripted-provider';
import { EvaluationRunner } from '../../src/evaluation/runner';
import { fixedTasks } from '../../src/evaluation/fixed-tasks';

describe('fixed offline evaluation', () => {
  test('passes all fixed tasks with the scripted model', async () => {
    const results = await new EvaluationRunner(createConfig()).run(new ScriptedCodingProvider(), fixedTasks);
    expect(results).toHaveLength(12);
    expect(results.every((result) => result.valid && result.passed)).toBe(true);
  });
});
