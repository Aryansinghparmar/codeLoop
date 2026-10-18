import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createConfig } from '../config/config';
import { loadEnvironment } from '../config/env';
import { OpenAiResponsesProvider } from '../llm/openai/responses-provider';
import { NativeProcessRunner } from '../infrastructure/process/native-process-runner';
import { liveTasksFor, parseSuite, parseTaskIds } from './suites';
import { EvaluationRunner } from './runner';
import type { BenchmarkTask, EvalSuite } from './types';
import { createRunDirectory, relativePath, writeRawResults } from './result-writer';
import { buildRepeatedSummary, type RunInput } from './summarize';

const root = process.cwd();
loadEnvironment(root);
if (process.env.CODELOOP_LIVE_CONFIRM !== 'yes') {
  console.error('Live evaluation is disabled. Set CODELOOP_LIVE_CONFIRM=yes after you approve the possible API cost.');
  process.exit(2);
}

// CODELOOP_EVAL_SUITE=v2 runs the v2 tasks; unset keeps v1, so the cv-baseline reproduces unchanged.
let suite: EvalSuite;
let tasks: BenchmarkTask[];
try {
  suite = parseSuite(process.env.CODELOOP_EVAL_SUITE);
  tasks = liveTasksFor(suite, parseTaskIds(process.env.CODELOOP_LIVE_TASKS));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const repeatCount = positiveInteger(process.env.CODELOOP_EVAL_REPEATS, 3);
const config = createConfig(root);
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(2);
}

const provider = new OpenAiResponsesProvider(config);
const runner = new EvaluationRunner(config);
const started = new Date();
// A new timestamped folder per run, so earlier results (the cv-baseline) are never overwritten.
const runDirectory = createRunDirectory(root, started);
const runs: RunInput[] = [];
const resultFiles: string[] = [];

// The suite budget (liveSuiteBudgetUsd) is checked inside each runner.run call, so it applies per
// repeat: N repeats can spend up to N times that amount in total.
for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
  const results = await runner.run(provider, tasks, new NativeProcessRunner(), { graderRunner: new NativeProcessRunner(), suite });
  const resultPath = join(runDirectory, `live-${provider.name}-repeat-${repeat}.jsonl`);
  writeRawResults(resultPath, results);
  runs.push({ label: `repeat-${repeat}`, results });
  resultFiles.push(relativePath(root, resultPath));
}

const summary = buildRepeatedSummary({ provider: provider.name, model: provider.model, suite, startedAt: started.toISOString(), taskCount: tasks.length, resultFiles, runs });
const summaryPath = join(runDirectory, `live-${provider.name}-repeated-summary.json`);
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ...summary, summaryPath: relativePath(root, summaryPath) }, null, 2));

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
