import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EvaluationResult } from './types';

export function writeRawResults(path: string, results: EvaluationResult[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, results.map((result) => JSON.stringify(result)).join('\n') + (results.length ? '\n' : ''), 'utf8');
}

export function appendRawResult(path: string, result: EvaluationResult): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(result)}\n`, 'utf8');
}
