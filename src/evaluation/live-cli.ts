import { join } from 'node:path';
import { createConfig } from '../config/config';
import { loadEnvironment } from '../config/env';
import { OpenAiResponsesProvider } from '../llm/openai/responses-provider';
import { NativeProcessRunner } from '../infrastructure/process/native-process-runner';
import { liveConfigFor, liveTasksFor, parseSuite, parseTaskIds, runSettingsOf, warnAboutSkips } from './suites';
import { EvaluationRunner } from './runner';
import type { BenchmarkTask, EvalSuite } from './types';
import { report } from './report-generator';
import { createRunDirectory, relativePath, writeRawResults } from './result-writer';

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

// v2 runs with 40 steps and a $3 suite cap per repeat unless CODELOOP_MAX_STEPS / CODELOOP_LIVE_SUITE_BUDGET_USD say otherwise.
const config = liveConfigFor(createConfig(root), suite);
const runSettings = runSettingsOf(config, suite, tasks.length);
console.error(`Run settings: ${JSON.stringify(runSettings)}`);
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(2);
}

const provider = new OpenAiResponsesProvider(config);
// A new timestamped folder per run (created before spending anything), so earlier results are never overwritten.
const runDirectory = createRunDirectory(root);
const results = await new EvaluationRunner(config).run(provider, tasks, new NativeProcessRunner(), { graderRunner: new NativeProcessRunner(), suite });
const summary = report(results);
const resultPath = join(runDirectory, `live-${provider.name}.jsonl`);
writeRawResults(resultPath, results);
warnAboutSkips(results);
console.log(JSON.stringify({ provider: provider.name, model: provider.model, suite, runSettings, summary, resultFile: relativePath(root, resultPath), results }, null, 2));
