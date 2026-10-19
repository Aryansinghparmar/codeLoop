// Heuristic checks for ways to make a hidden bun test "pass" without the code
// being right. They are a second line of defence: the grader already runs the
// hidden test in an isolated copy and reads bun's JUnit report, and the hidden
// test checks that its matchers still reject wrong values. A scan like this can
// be evaded by a determined adversary, so a hit fails the task with a reason a
// human can check, and a miss proves nothing.
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface TamperRule {
  label: string;
  pattern: RegExp;
  /** Only check files whose project path matches (e.g. source files only). */
  only?: RegExp;
}

const RULES: readonly TamperRule[] = [
  { label: 'exits or kills the process, or sets its exit code', pattern: /process\s*(?:\?\.)?\s*(?:\.|\[)\s*['"`]?\s*(?:exit|reallyExit|kill|abort|exitCode)\b|\bexitCode\b|\breallyExit\b/u },
  { label: 'glues short strings together (e.g. "ex" + "it"), which hides names from this scan', pattern: /['"`][\w:.$]{0,6}['"`]\s*\+\s*['"`][\w:.$]{0,6}['"`]/u },
  { label: 'extends or replaces test matchers', pattern: /\bexpect\s*\.\s*extend\b|\.extend\s*\(\s*\{\s*to[A-Z]/u },
  { label: 'loads a module from a computed name', pattern: /\brequire\s*\(\s*(?!['"`][^'"`]*['"`]\s*\))|\bimport\s*\(\s*(?!['"`][^'"`]*['"`]\s*\))/u },
  { label: 'starts other processes or workers', pattern: /child_process|\bBun\s*\.\s*(?:spawn|spawnSync|\$)|worker_threads|\bnew\s+Worker\b/u },
  { label: 'decodes hidden text', pattern: /fromCharCode|\batob\s*\(|['"`]base64['"`]/u },
  { label: 'changes globals or prototypes', pattern: /\bglobalThis\b|\.prototype\s*\.\s*\w+\s*=|\bdefineProperty\b/u },
  // Test files (`*.test.ts`, `*.spec.ts`) may import bun:test; that is what tests do. A non-test module that
  // imports it is how a source file patches matchers the hidden test relies on. Matcher patching itself is
  // caught in every file by the 'extends or replaces test matchers' rule above.
  { label: 'imports bun:test from source code', pattern: /bun:test/u, only: /^src\/(?!.*\.(?:test|spec)\.[cm]?[jt]sx?$)/u },
];

/** Config files that change how bun resolves, preloads or loads code. They must not appear unless the task set them up. */
export const CONFIG_FILE = /(?:^|\/)(?:bunfig\.toml|package\.json|package-lock\.json|bun\.lockb?|tsconfig[^/]*\.json|jsconfig[^/]*\.json|\.npmrc|node_modules)$/u;

/** The rule labels a file's content triggers. */
export function tamperFindings(path: string, content: string): string[] {
  return RULES.filter((rule) => (!rule.only || rule.only.test(path)) && rule.pattern.test(content)).map((rule) => rule.label);
}

export interface TreeEntry {
  /** Project path with forward slashes. */
  path: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
}

/** Every entry under `root`, without following links. node_modules is listed but not descended into. */
export async function listTree(root: string, directory = ''): Promise<TreeEntry[]> {
  const entries = await readdir(join(root, directory)).catch(() => [] as string[]);
  const tree: TreeEntry[] = [];
  for (const name of entries) {
    const path = directory ? `${directory}/${name}` : name;
    const info = await lstat(join(root, path));
    const kind = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
    tree.push({ path, kind });
    if (kind === 'directory' && name !== 'node_modules') tree.push(...await listTree(root, path));
  }
  return tree;
}

/**
 * Problems in a task directory after the agent finished, compared with the
 * files the task set up (`fixtures`). Unchanged fixtures are trusted.
 */
export async function scanWorkspace(root: string, fixtures: Record<string, string>): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of await listTree(root)) {
    const fixture = fixtures[entry.path];
    if (entry.kind === 'symlink' || entry.kind === 'other') {
      problems.push(`${entry.path}: a link or special file`);
      continue;
    }
    if (CONFIG_FILE.test(entry.path)) {
      const unchanged = entry.kind === 'file' && fixture !== undefined && (await readFile(join(root, entry.path), 'utf8')) === fixture;
      if (!unchanged) problems.push(`${entry.path}: tampered-config (a build or runtime config file the task did not set up)`);
      continue;
    }
    if (entry.kind !== 'file') continue;
    const content = await readFile(join(root, entry.path), 'utf8').catch(() => '');
    if (content === fixture) continue;
    for (const finding of tamperFindings(entry.path, content)) problems.push(`${entry.path}: ${finding}`);
  }
  return problems;
}
