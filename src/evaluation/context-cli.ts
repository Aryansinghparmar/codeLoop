import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runContextBenchmark } from './context-benchmark';

const result = runContextBenchmark();
const resultPath = join(process.cwd(), 'evals', 'results', 'context-benchmark.json');
mkdirSync(join(process.cwd(), 'evals', 'results'), { recursive: true });
writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ...result, resultPath }, null, 2));
