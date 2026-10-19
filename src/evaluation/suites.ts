import type { CodeLoopConfig } from '../config/config';
import { fixedTasks } from './fixed-tasks';
import { v2Tasks } from './tasks-v2';
import type { BenchmarkTask, EvalSuite, EvaluationResult } from './types';

/**
 * Reads CODELOOP_EVAL_SUITE. Unset or empty means v1, so the cv-baseline is
 * reproduced exactly as before; any value other than v1 or v2 is an error
 * (a typo must not silently run, and pay for, the wrong suite).
 */
export function parseSuite(value: string | undefined): EvalSuite {
  const suite = (value ?? '').trim().toLowerCase();
  if (suite === '' || suite === 'v1') return 'v1';
  if (suite === 'v2') return 'v2';
  throw new Error(`CODELOOP_EVAL_SUITE must be v1 or v2, not ${JSON.stringify(value)}.`);
}

/** The live tasks of a suite, optionally narrowed to the ids in CODELOOP_LIVE_TASKS. Unknown ids are an error. */
export function liveTasksFor(suite: EvalSuite, requestedIds: string[] = []): BenchmarkTask[] {
  const tasks = (suite === 'v2' ? v2Tasks : fixedTasks).filter((task) => task.live);
  const unknown = requestedIds.filter((id) => !tasks.some((task) => task.id === id));
  if (unknown.length) throw new Error(`Unknown ${suite} task id(s): ${unknown.join(', ')}.`);
  return requestedIds.length ? tasks.filter((task) => requestedIds.includes(task.id)) : tasks;
}

/**
 * Per-suite defaults for live runs. v2 tasks are longer: V15 alone needs at
 * least ~19 steps with no mistakes, so v2 gets 40 steps and a $3 suite cap per
 * repeat (runner.run call). v1 keeps the app defaults (24 steps, $1.25), so
 * the cv-baseline is reproduced unchanged. The per-task cap stays at the app
 * default ($0.40) for both.
 */
export const SUITE_DEFAULTS: Record<EvalSuite, { maxSteps?: number; liveSuiteBudgetUsd?: number }> = {
  v1: {},
  v2: { maxSteps: 40, liveSuiteBudgetUsd: 3 },
};

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The config a live run of `suite` uses. Explicit settings win over the suite
 * defaults: CODELOOP_MAX_STEPS (whole number) and CODELOOP_LIVE_SUITE_BUDGET_USD
 * (USD per repeat).
 */
export function liveConfigFor(config: CodeLoopConfig, suite: EvalSuite, env: Record<string, string | undefined> = process.env): CodeLoopConfig {
  const steps = positiveNumber(env.CODELOOP_MAX_STEPS);
  const budget = positiveNumber(env.CODELOOP_LIVE_SUITE_BUDGET_USD);
  return {
    ...config,
    maxSteps: steps !== undefined && Number.isInteger(steps) ? steps : SUITE_DEFAULTS[suite].maxSteps ?? config.maxSteps,
    liveSuiteBudgetUsd: budget ?? SUITE_DEFAULTS[suite].liveSuiteBudgetUsd ?? config.liveSuiteBudgetUsd,
  };
}

export interface RunSettings {
  suite: EvalSuite;
  taskCount: number;
  maxSteps: number;
  liveTaskBudgetUsd: number;
  /** Checked inside each runner.run call, i.e. per repeat. */
  liveSuiteBudgetUsdPerRepeat: number;
}

/** What a live run was configured with, written into its summary so results can be compared fairly. */
export function runSettingsOf(config: CodeLoopConfig, suite: EvalSuite, taskCount: number): RunSettings {
  return { suite, taskCount, maxSteps: config.maxSteps, liveTaskBudgetUsd: config.liveTaskBudgetUsd, liveSuiteBudgetUsdPerRepeat: config.liveSuiteBudgetUsd };
}

/** Says loudly on stderr when tasks were skipped because the suite budget ran out, so no skip goes unnoticed. */
export function warnAboutSkips(results: EvaluationResult[]): number {
  const skipped = results.filter((result) => result.stopReason === 'suite-budget-skip').map((result) => result.taskId);
  if (skipped.length) console.error(`WARNING: ${skipped.length} task run(s) were skipped because the suite budget was reached: ${skipped.join(', ')}. They count as not passed.`);
  return skipped.length;
}

/** Splits a comma-separated id list such as "V01, V15". */
export function parseTaskIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map((id) => id.trim()).filter(Boolean);
}
