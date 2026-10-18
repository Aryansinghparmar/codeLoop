import { createConfig } from '../config/config';
import { loadEnvironment } from '../config/env';
import { ScriptedCodingProvider } from '../llm/scripted-provider';
import { EvaluationRunner } from './runner';
import { fixedTasks } from './fixed-tasks';
import { report } from './report-generator';
import { writeRawResults } from './result-writer';
import { join } from 'node:path';

const root = process.cwd();
loadEnvironment(root);
const provider = new ScriptedCodingProvider();
const results = await new EvaluationRunner(createConfig(root)).run(provider, fixedTasks);
const summary = report(results);
writeRawResults(join(root, 'evals', 'results', 'offline.jsonl'), results);
// The offline suite uses a fake process runner, so no test is really executed.
const grading = 'offline: file assertions and trace checks only; tests not executed (testsExecuted: false)';
console.log(JSON.stringify({ provider: provider.name, grading, testsExecuted: false, summary, results }, null, 2));
