import { fixedTasks } from './fixed-tasks';
import { v2Tasks } from './tasks-v2';
import type { BenchmarkTask, EvalSuite } from './types';

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

/** Splits a comma-separated id list such as "V01, V15". */
export function parseTaskIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map((id) => id.trim()).filter(Boolean);
}
