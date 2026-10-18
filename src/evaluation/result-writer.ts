import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { EvaluationResult } from './types';

export function writeRawResults(path: string, results: EvaluationResult[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, results.map((result) => JSON.stringify(result)).join('\n') + (results.length ? '\n' : ''), 'utf8');
}

export function appendRawResult(path: string, result: EvaluationResult): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(result)}\n`, 'utf8');
}

/** `YYYYMMDD-HHMMSS` in UTC, e.g. 20261018-142501. */
export function runFolderName(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

/**
 * Creates a fresh `evals/results/<YYYYMMDD-HHMMSS>/` folder for one live run.
 * It fails if the folder already exists, so a new run can never overwrite an
 * earlier one (such as the cv-baseline files in evals/results/).
 */
export function createRunDirectory(root: string, date: Date = new Date()): string {
  const parent = join(root, 'evals', 'results');
  mkdirSync(parent, { recursive: true });
  const folder = join(parent, runFolderName(date));
  mkdirSync(folder);
  return folder;
}

/** Path relative to `root` with forward slashes, so result files don't leak local absolute paths. */
export function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}
