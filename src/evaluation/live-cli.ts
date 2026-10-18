import { join } from 'node:path';
import { createConfig } from '../config/config';
import { loadEnvironment } from '../config/env';
import { OpenAiResponsesProvider } from '../llm/openai/responses-provider';
import { NativeProcessRunner } from '../infrastructure/process/native-process-runner';
import { fixedTasks } from './fixed-tasks';
import { EvaluationRunner } from './runner';
import { report } from './report-generator';
import { createRunDirectory, relativePath, writeRawResults } from './result-writer';

const root = process.cwd();
loadEnvironment(root);
if (process.env.CODELOOP_LIVE_CONFIRM !== 'yes') {
  console.error('Live evaluation is disabled. Set CODELOOP_LIVE_CONFIRM=yes after you approve the possible API cost.');
  process.exit(2);
}

const config = createConfig(root);
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(2);
}

const provider = new OpenAiResponsesProvider(config);
const requestedTasks = process.env.CODELOOP_LIVE_TASKS?.split(',').map((value) => value.trim()).filter(Boolean);
const tasks = fixedTasks.filter((task) => task.live && (!requestedTasks?.length || requestedTasks.includes(task.id)));
// A new timestamped folder per run (created before spending anything), so earlier results are never overwritten.
const runDirectory = createRunDirectory(root);
const results = await new EvaluationRunner(config).run(provider, tasks, new NativeProcessRunner(), { graderRunner: new NativeProcessRunner() });
const summary = report(results);
const resultPath = join(runDirectory, `live-${provider.name}.jsonl`);
writeRawResults(resultPath, results);
console.log(JSON.stringify({ provider: provider.name, model: provider.model, summary, resultFile: relativePath(root, resultPath), results }, null, 2));
