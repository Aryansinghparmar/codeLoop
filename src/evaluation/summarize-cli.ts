// Recomputes every evaluation number from stored JSONL results. It never calls
// a provider and never writes to an input file.
//
// Usage: bun run eval:summarize [--dir evals/results] [--pattern live-openai-repeat-*.jsonl] [--out <file>] [--json] [--allow-mixed-suites]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { formatSummary, summarize, type RunInput } from './summarize';
import type { EvaluationResult } from './types';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? join('evals', 'results'));
const pattern = args.pattern ?? 'live-openai-repeat-*.jsonl';

if (!existsSync(dir)) fail(`Directory not found: ${dir}`);
const glob = new Bun.Glob(pattern);
const files = readdirSync(dir)
  .filter((name) => glob.match(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((name) => join(dir, name));
if (!files.length) fail(`No files in ${dir} match ${pattern}`);
const outPath = args.out ? resolve(args.out) : undefined;
if (outPath && files.some((file) => samePath(file, outPath))) fail(`Refusing to overwrite an input file: ${outPath}`);

const runs: RunInput[] = files.map((file) => ({ label: basename(file, '.jsonl'), results: readJsonl(file) }));
const summary = summarize(runs);
// v1 and v2 rows pooled together would give a meaningless pass rate.
if (summary.suites.length > 1 && !args.allowMixedSuites) fail(`The input files mix suites (${summary.suites.join(', ')}). Summarise one suite at a time, or pass --allow-mixed-suites.`);
const inputFiles = files.map((file) => relative(process.cwd(), file).replaceAll('\\', '/'));

if (args.json) console.log(JSON.stringify({ inputFiles, ...summary }, null, 2));
else console.log(`Input files: ${inputFiles.join(', ')}\n\n${formatSummary(summary)}`);

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ inputFiles, ...summary }, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${relative(process.cwd(), outPath)}`);
}

function readJsonl(file: string): EvaluationResult[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationResult);
}

function parseArgs(argv: string[]): { dir?: string; pattern?: string; out?: string; json?: boolean; allowMixedSuites?: boolean } {
  const parsed: { dir?: string; pattern?: string; out?: string; json?: boolean; allowMixedSuites?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') { parsed.json = true; continue; }
    if (flag === '--allow-mixed-suites') { parsed.allowMixedSuites = true; continue; }
    const value = argv[index + 1];
    if ((flag === '--dir' || flag === '--pattern' || flag === '--out') && value) {
      parsed[flag.slice(2) as 'dir' | 'pattern' | 'out'] = value;
      index += 1;
      continue;
    }
    fail(`Unknown or incomplete argument: ${flag}\nUsage: bun run eval:summarize [--dir evals/results] [--pattern live-openai-repeat-*.jsonl] [--out <file>] [--json] [--allow-mixed-suites]`);
  }
  return parsed;
}

function samePath(a: string, b: string): boolean {
  const normalise = (path: string): string => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
  return normalise(a) === normalise(b);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
