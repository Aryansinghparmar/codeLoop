import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessRunner } from '../infrastructure/process/process-runner';
import { redactSecrets } from '../shared/redact';
import { CONFIG_FILE } from './tamper-scan';
import type { BenchmarkTask, IsolatedGrader } from './types';

/** Where the grader writes its own hidden test, after the agent has finished. */
export const GRADER_TEST_FILE = 'tests/grader-check.test.ts';
const GRADER_TIMEOUT_MS = 60_000;

/** The grader's own bunfig.toml in an isolated grading directory: no .env auto-loading, no preloads. */
export const GRADER_BUNFIG = 'env = false\n';

export interface GraderTestResult {
  testsExecuted: boolean;
  testsPassed?: boolean;
  details: string[];
}

/**
 * Runs `bun test` on the task's test file (and the grader's hidden test, if
 * any) in the task directory. Without a process runner, as in the offline
 * suite, nothing is executed and the result says so. Any grader error is a
 * failed grade, never a crash of the run.
 */
export async function runGraderTests(task: BenchmarkTask, root: string, runner: ProcessRunner | undefined): Promise<GraderTestResult> {
  if (!task.testFile && !task.graderTest) return { testsExecuted: false, details: [] };
  if (!runner) return { testsExecuted: false, details: ['grader tests not executed (offline run)'] };
  if (task.isolatedGrader && task.graderTest) return runIsolatedGrader(task.graderTest, task.isolatedGrader, root, runner);
  const files = task.testFile ? [task.testFile] : [];
  if (task.graderTest) files.push(GRADER_TEST_FILE);
  const command = `bun test ${files.map((file) => `./${file}`).join(' ')}`;
  try {
    if (task.graderTest) {
      // The agent may have put a file or a directory at this path; replace whatever is there.
      await rm(join(root, GRADER_TEST_FILE), { recursive: true, force: true });
      await mkdir(join(root, 'tests'), { recursive: true });
      await writeFile(join(root, GRADER_TEST_FILE), task.graderTest, 'utf8');
    }
    const result = await runner.run(command, { cwd: root, timeoutMs: GRADER_TIMEOUT_MS });
    const passed = result.exitCode === 0 && !result.timedOut;
    const details = [`grader ran "${command}": ${passed ? 'ok' : `FAILED (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`}`];
    if (!passed) details.push(`grader output: ${redactSecrets(`${result.stdout}\n${result.stderr}`).trim().slice(-600)}`);
    return { testsExecuted: true, testsPassed: passed, details };
  } catch (error) {
    return { testsExecuted: true, testsPassed: false, details: [`grader could not run "${command}": ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/**
 * v2 grading. The agent's directory is not trusted: it may contain a
 * bunfig.toml with a preload, a package.json, a tsconfig with path mappings,
 * or files that only pretend to be a test summary. So the grader copies only
 * the listed paths (symlinks resolved to plain files) into a fresh directory,
 * adds its own bunfig.toml and the hidden test, and reads the outcome from
 * bun's JUnit report, written outside both directories. It passes only when
 * the report names exactly the expected tests and every one of them passed.
 */
async function runIsolatedGrader(graderTest: string, spec: IsolatedGrader, root: string, runner: ProcessRunner): Promise<GraderTestResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'codeloop-grade-'));
  const reportPath = join(tmpdir(), `codeloop-junit-${randomUUID()}.xml`);
  const command = `bun test ./${GRADER_TEST_FILE} --reporter=junit --reporter-outfile='${reportPath}'`;
  try {
    for (const path of spec.copy) {
      const exists = await stat(join(root, path)).then(() => true, () => false);
      // Config files never reach the grading copy, wherever they were put.
      if (exists) await cp(join(root, path), join(workDir, path), { recursive: true, dereference: true, filter: (source) => !CONFIG_FILE.test(source.replaceAll('\\', '/')) });
    }
    await writeFile(join(workDir, 'bunfig.toml'), GRADER_BUNFIG, 'utf8');
    await mkdir(join(workDir, 'tests'), { recursive: true });
    await writeFile(join(workDir, GRADER_TEST_FILE), graderTest, 'utf8');
    const result = await runner.run(command, { cwd: workDir, timeoutMs: GRADER_TIMEOUT_MS });
    const report = await readFile(reportPath, 'utf8').catch(() => undefined);
    const verdict = judgeJUnit(report, spec.testNames);
    const exitedCleanly = result.exitCode === 0 && !result.timedOut;
    const passed = exitedCleanly && verdict.ok;
    const details = [
      `grader ran the hidden test in an isolated copy of ${spec.copy.join(', ')}: ${exitedCleanly ? 'exit 0' : `FAILED (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`}`,
      `grader JUnit report: ${verdict.ok ? `all ${spec.testNames.length} expected tests passed` : `FAILED (${verdict.problem})`}`,
    ];
    if (!passed) details.push(`grader output: ${redactSecrets(`${result.stdout}\n${result.stderr}`).trim().slice(-600)}`);
    return { testsExecuted: true, testsPassed: passed, details };
  } catch (error) {
    return { testsExecuted: true, testsPassed: false, details: [`grader could not run "${command}": ${error instanceof Error ? error.message : String(error)}`] };
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(reportPath, { force: true });
  }
}

export interface JUnitCase {
  name: string;
  passed: boolean;
}

function unescapeXml(text: string): string {
  return text.replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');
}

/** The testcases in a bun JUnit report. A case passed when it has no failure, error or skipped child. */
export function parseJUnit(xml: string): JUnitCase[] {
  const cases: JUnitCase[] = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gu)) {
    const name = /\bname="([^"]*)"/u.exec(match[1] ?? '')?.[1];
    if (name === undefined) continue;
    cases.push({ name: unescapeXml(name), passed: !/<(?:failure|error|skipped)\b/u.test(match[2] ?? '') });
  }
  return cases;
}

/** True only when the report lists exactly the expected test names, each once, all passed. */
export function judgeJUnit(xml: string | undefined, expected: string[]): { ok: boolean; problem?: string } {
  if (xml === undefined) return { ok: false, problem: 'no JUnit report was written' };
  const cases = parseJUnit(xml);
  const names = cases.map((item) => item.name);
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length) return { ok: false, problem: `missing ${missing.join('; ')}` };
  const extra = names.filter((name) => !expected.includes(name));
  if (extra.length || names.length !== expected.length) return { ok: false, problem: `unexpected test cases ${extra.join('; ') || '(duplicates)'}` };
  const failed = cases.filter((item) => !item.passed).map((item) => item.name);
  return failed.length ? { ok: false, problem: `not passed: ${failed.join('; ')}` } : { ok: true };
}
