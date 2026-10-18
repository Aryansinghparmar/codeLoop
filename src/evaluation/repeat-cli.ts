import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConfig } from '../config/config';
import { loadEnvironment } from '../config/env';
import { OpenAiResponsesProvider } from '../llm/openai/responses-provider';
import { NativeProcessRunner } from '../infrastructure/process/native-process-runner';
import { fixedTasks } from './fixed-tasks';
import { EvaluationRunner } from './runner';
import { report, type EvaluationReport } from './report-generator';
import { writeRawResults } from './result-writer';
import type { EvaluationResult } from './types';

const root = process.cwd();
loadEnvironment(root);
if (process.env.CODELOOP_LIVE_CONFIRM !== 'yes') {
  console.error('Live evaluation is disabled. Set CODELOOP_LIVE_CONFIRM=yes after you approve the possible API cost.');
  process.exit(2);
}

const repeatCount = positiveInteger(process.env.CODELOOP_EVAL_REPEATS, 3);
const config = createConfig(root);
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(2);
}

const provider = new OpenAiResponsesProvider(config);
const requestedTasks = process.env.CODELOOP_LIVE_TASKS?.split(',').map((value) => value.trim()).filter(Boolean);
const tasks = fixedTasks.filter((task) => task.live && (!requestedTasks?.length || requestedTasks.includes(task.id)));
const runner = new EvaluationRunner(config);
const reports: EvaluationReport[] = [];
const resultFiles: string[] = [];
const allResults: EvaluationResult[] = [];

for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
  const results = await runner.run(provider, tasks, new NativeProcessRunner(), { graderRunner: new NativeProcessRunner() });
  const summary = report(results);
  reports.push(summary);
  allResults.push(...results);
  const resultPath = join(root, 'evals', 'results', `live-${provider.name}-repeat-${repeat}.jsonl`);
  writeRawResults(resultPath, results);
  resultFiles.push(resultPath);
}

const aggregate = report(allResults);
const summaryPath = join(root, 'evals', 'results', `live-${provider.name}-repeated-summary.json`);
mkdirSync(join(root, 'evals', 'results'), { recursive: true });
writeFileSync(summaryPath, JSON.stringify({ provider: provider.name, model: process.env.OPENAI_MODEL ?? 'configured-provider-model', repeatCount, taskCount: tasks.length, reports, aggregate, resultFiles }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ provider: provider.name, model: process.env.OPENAI_MODEL ?? 'configured-provider-model', repeatCount, taskCount: tasks.length, reports, aggregate, summaryPath, resultFiles }, null, 2));

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
