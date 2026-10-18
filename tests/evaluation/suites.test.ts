import { describe, expect, test } from 'bun:test';
import { createConfig } from '../../src/config/config';
import { EvaluationRunner } from '../../src/evaluation/runner';
import { liveTasksFor, parseSuite, parseTaskIds } from '../../src/evaluation/suites';
import type { BenchmarkTask } from '../../src/evaluation/types';
import { ScriptedProvider } from '../../src/llm/scripted-provider';

describe('evaluation suite selection', () => {
  test('defaults to v1 and rejects unknown suites', () => {
    expect(parseSuite(undefined)).toBe('v1');
    expect(parseSuite('')).toBe('v1');
    expect(parseSuite(' V2 ')).toBe('v2');
    expect(() => parseSuite('v3')).toThrow('CODELOOP_EVAL_SUITE');
  });

  test('v1 is still the ten live cv-baseline tasks; v2 is the 19 new ones', () => {
    expect(liveTasksFor('v1').map((task) => task.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']);
    expect(liveTasksFor('v2')).toHaveLength(19);
    expect(liveTasksFor('v2', parseTaskIds('V15, V01')).map((task) => task.id)).toEqual(['V01', 'V15']);
  });

  test('an id from the other suite is an error, not an empty run', () => {
    expect(() => liveTasksFor('v1', ['V01'])).toThrow('Unknown v1 task id');
    expect(() => liveTasksFor('v2', ['T1'])).toThrow('Unknown v2 task id');
  });

  test('the runner writes the suite into every row, including failed ones', async () => {
    const broken: BenchmarkTask = { id: 'X1', name: 'broken', live: true, prompt: 'nothing', async setup() { throw new Error('setup failed'); }, async assert() { return { passed: true, details: [] }; } };
    const results = await new EvaluationRunner(createConfig()).run(new ScriptedProvider(), [broken], undefined, { suite: 'v2' });
    expect(results[0]?.suite).toBe('v2');
    expect(results[0]?.valid).toBe(false);
    const unlabelled = await new EvaluationRunner(createConfig()).run(new ScriptedProvider(), [broken]);
    expect(unlabelled[0] && 'suite' in unlabelled[0]).toBe(false);
  });
});
