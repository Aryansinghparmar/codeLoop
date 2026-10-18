import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessRunner } from '../infrastructure/process/process-runner';
import { redactSecrets } from '../shared/redact';
import type { BenchmarkTask } from './types';

/** Where the grader writes its own hidden test, after the agent has finished. */
export const GRADER_TEST_FILE = 'tests/grader-check.test.ts';
const GRADER_TIMEOUT_MS = 60_000;

export interface GraderTestResult {
  testsExecuted: boolean;
  testsPassed?: boolean;
  details: string[];
}

/**
 * Runs `bun test` on the task's test file (and the grader's hidden test, if
 * any) in the task directory. Without a process runner, as in the offline
 * suite, nothing is executed and the result says so.
 */
export async function runGraderTests(task: BenchmarkTask, root: string, runner: ProcessRunner | undefined): Promise<GraderTestResult> {
  if (!task.testFile && !task.graderTest) return { testsExecuted: false, details: [] };
  if (!runner) return { testsExecuted: false, details: ['grader tests not executed (offline run)'] };
  const files = task.testFile ? [task.testFile] : [];
  if (task.graderTest) {
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, GRADER_TEST_FILE), task.graderTest, 'utf8');
    files.push(GRADER_TEST_FILE);
  }
  const command = `bun test ${files.map((file) => `./${file}`).join(' ')}`;
  try {
    const result = await runner.run(command, { cwd: root, timeoutMs: GRADER_TIMEOUT_MS });
    const passed = result.exitCode === 0 && !result.timedOut;
    const details = [`grader ran "${command}": ${passed ? 'ok' : `FAILED (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`}`];
    if (!passed) details.push(`grader output: ${redactSecrets(`${result.stdout}\n${result.stderr}`).trim().slice(-600)}`);
    return { testsExecuted: true, testsPassed: passed, details };
  } catch (error) {
    return { testsExecuted: true, testsPassed: false, details: [`grader could not run "${command}": ${error instanceof Error ? error.message : String(error)}`] };
  }
}
