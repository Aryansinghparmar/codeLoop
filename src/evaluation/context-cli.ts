// Usage: bun run eval:context [--out <file>]
// Prints the context benchmark. Writes JSON only when --out is given, so the
// stored evals/results/context-benchmark.json is never overwritten by accident.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { runContextBenchmark } from './context-benchmark';

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
if ((outIndex >= 0 && !out) || argv.length !== (outIndex >= 0 ? 2 : 0)) {
  console.error('Usage: bun run eval:context [--out <file>]');
  process.exit(2);
}

const result = runContextBenchmark();
console.log(JSON.stringify(result, null, 2));
if (out) {
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${relative(process.cwd(), outPath).replaceAll('\\', '/')}`);
}
