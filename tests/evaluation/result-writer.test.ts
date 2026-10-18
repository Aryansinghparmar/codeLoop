import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunDirectory, relativePath, runFolderName } from '../../src/evaluation/result-writer';
import { buildRepeatedSummary, STAT_METHOD } from '../../src/evaluation/summarize';
import type { EvaluationResult } from '../../src/evaluation/types';

describe('live result output', () => {
  test('names run folders YYYYMMDD-HHMMSS (UTC)', () => {
    expect(runFolderName(new Date('2026-10-18T09:05:07.123Z'))).toBe('20261018-090507');
  });

  test('creates a new folder per run and refuses to reuse one', () => {
    const root = mkdtempSync(join(tmpdir(), 'codeloop-writer-'));
    try {
      const date = new Date('2026-10-18T09:05:07Z');
      const folder = createRunDirectory(root, date);
      expect(existsSync(folder)).toBe(true);
      expect(relativePath(root, folder)).toBe('evals/results/20261018-090507');
      expect(() => createRunDirectory(root, date)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the repeated summary records its stat method, model and relative files', () => {
    const row: EvaluationResult = { taskId: 'T1', provider: 'openai', model: 'gpt-6-luna-2026-09-01', passed: true, valid: true, durationMs: 10, steps: 1, toolCalls: 0, failedToolCalls: 0, recoveredFailures: 0, reductions: 0, inputTokens: 1, outputTokens: 1, totalTokens: 2, assertionDetails: [], testsExecuted: true, testsPassed: true, assertionsPassed: true };
    const summary = buildRepeatedSummary({ provider: 'openai', model: 'gpt-6-luna', startedAt: '2026-10-18T09:05:07.000Z', taskCount: 1, resultFiles: ['evals/results/20261018-090507/live-openai-repeat-1.jsonl'], runs: [{ label: 'repeat-1', results: [row] }] });
    expect(summary.statMethod).toBe(STAT_METHOD);
    expect(summary.aggregate.statMethod).toBe(STAT_METHOD);
    expect(summary.model).toBe('gpt-6-luna');
    expect(summary.reportedModels).toEqual(['gpt-6-luna-2026-09-01']);
    expect(summary.grader).toEqual({ rowsWithGraderTestRun: 1, testsPassed: 1, rowsWithAssertionResult: 1, assertionsPassed: 1 });
    expect(summary.resultFiles.every((file) => !file.includes(':') && !file.startsWith('/'))).toBe(true);
  });
});
