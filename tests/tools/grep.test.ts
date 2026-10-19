import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConfig } from '../../src/config/config';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { createBuiltinRegistry } from '../../src/tools/builtins';
import { grepTool, MAX_GREP_RESULTS } from '../../src/tools/grep';
import { MAX_READ_BYTES } from '../../src/tools/read';
import type { ToolExecutionContext, ToolResult } from '../../src/tools/tool';
import { temporaryRoot, removeRoot } from '../helpers';

let base: string;
let root: string;
let context: ToolExecutionContext;

interface GrepBody { matches: string[]; truncated: boolean; filesSkipped: number; note?: string }

function body(result: ToolResult): GrepBody {
  expect(result.ok).toBe(true);
  return JSON.parse(result.content);
}

function linkDirectory(target: string, link: string): void {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

beforeEach(async () => {
  base = realpathSync.native(await temporaryRoot());
  root = join(base, 'root');
  mkdirSync(join(root, 'src', 'reports'), { recursive: true });
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'src', 'reports', 'sales.ts'), "import { legacyFormat } from './old';\n\nexport const total = legacyFormat(1);\n");
  writeFileSync(join(root, 'src', 'config.ts'), 'export const port = Number(process.env.PORT);\nexport const Level = "INFO";\n');
  const guard = new PathGuard(root);
  context = { projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard) };
});

afterEach(async () => {
  await removeRoot(base);
});

describe('grep tool', () => {
  test('finds matching lines with project-relative paths and line numbers', async () => {
    const { matches, truncated } = body(await grepTool.execute({ pattern: 'legacyFormat\\(' }, context));
    expect(matches).toEqual(['src/reports/sales.ts:3: export const total = legacyFormat(1);']);
    expect(truncated).toBe(false);
  });

  test('searches one file when path is a file', async () => {
    expect(body(await grepTool.execute({ pattern: 'export', path: 'src/config.ts' }, context)).matches).toEqual([
      'src/config.ts:1: export const port = Number(process.env.PORT);',
      'src/config.ts:2: export const Level = "INFO";',
    ]);
  });

  test('ignoreCase and literal', async () => {
    expect(body(await grepTool.execute({ pattern: 'level' }, context)).matches).toEqual([]);
    expect(body(await grepTool.execute({ pattern: 'level', ignoreCase: true }, context)).matches).toHaveLength(1);
    // As a regex `process.env(` is invalid; as literal text it is found.
    expect(body(await grepTool.execute({ pattern: 'Number(process.env', literal: true }, context)).matches).toHaveLength(1);
    expect(body(await grepTool.execute({ pattern: 'x.y', literal: true }, context)).matches).toEqual([]);
  });

  test('an invalid regex is a clear error that suggests literal', async () => {
    const result = await grepTool.execute({ pattern: 'legacyFormat(' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('not a valid regular expression');
    expect(result.content).toContain('literal: true');
  });

  test('never opens .env, .git/config or private keys, even when their contents match', async () => {
    const canary = 'CANARY_SECRET_7731';
    writeFileSync(join(root, '.env'), `${canary}=1\n`);
    writeFileSync(join(root, 'src', '.env.local'), `${canary}=2\n`);
    writeFileSync(join(root, '.git', 'config'), `[remote] ${canary}\n`);
    writeFileSync(join(root, 'id_rsa'), `${canary}\n`);
    writeFileSync(join(root, 'src', 'server.pem'), `${canary}\n`);
    writeFileSync(join(root, '.env.example'), `${canary}=\n`);
    const reads = spyOn(fs, 'readFileSync');
    const stats = spyOn(fs, 'statSync');
    try {
      const { matches } = body(await grepTool.execute({ pattern: canary }, context));
      expect(matches).toEqual([`.env.example:1: ${canary}=`]);
      const touched = [...reads.mock.calls, ...stats.mock.calls].map((call) => String(call[0]));
      expect(touched.some((path) => path.endsWith('.env.example'))).toBe(true); // the spies do see the tool's reads
      for (const name of ['.env', '.env.local', 'config', 'id_rsa', 'server.pem']) {
        expect(touched.some((path) => path.endsWith(`${name}`) && !path.endsWith('.env.example'))).toBe(false);
      }
    } finally {
      reads.mockRestore();
      stats.mockRestore();
    }
  });

  test('refuses a protected file or directory as the search path', async () => {
    writeFileSync(join(root, '.env'), 'X=1\n');
    const { registry, pathGuard, permissionPolicy } = createBuiltinRegistry(createConfig(root));
    for (const path of ['.env', '.git', '../root2', '..']) {
      const result = await registry.execute('grep', { pattern: 'X', path }, { projectRoot: root, pathGuard, permissionPolicy });
      expect(result.ok).toBe(false);
      expect(result.content).toMatch(/protected|outside the project root/u);
    }
  });

  test('does not follow a junction or symlink out of the root or into .git', async () => {
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'leak.ts'), 'NEEDLE outside\n');
    writeFileSync(join(root, '.git', 'HEAD'), 'NEEDLE in git\n');
    linkDirectory(join(base, 'outside'), join(root, 'src', 'escape'));
    linkDirectory(join(root, '.git'), join(root, 'src', 'gitlink'));
    linkDirectory(join(root, 'src'), join(root, 'src', 'loop'));
    writeFileSync(join(root, 'src', 'inside.ts'), 'NEEDLE inside\n');
    expect(body(await grepTool.execute({ pattern: 'NEEDLE' }, context)).matches).toEqual(['src/inside.ts:1: NEEDLE inside']);
  });

  test('skips binary and oversized files', async () => {
    writeFileSync(join(root, 'src', 'image.bin'), Buffer.concat([Buffer.from('NEEDLE'), Buffer.from([0, 1, 2])]));
    writeFileSync(join(root, 'src', 'huge.txt'), `NEEDLE${'x'.repeat(MAX_READ_BYTES)}`);
    const { matches, filesSkipped } = body(await grepTool.execute({ pattern: 'NEEDLE' }, context));
    expect(matches).toEqual([]);
    expect(filesSkipped).toBe(2);
  });

  test('caps the results, reports truncated, and cuts long lines', async () => {
    writeFileSync(join(root, 'src', 'many.ts'), `${'hit\n'.repeat(MAX_GREP_RESULTS + 5)}hit ${'y'.repeat(500)}\n`);
    const capped = body(await grepTool.execute({ pattern: 'hit', maxResults: 1_000 }, context));
    expect(capped.matches).toHaveLength(MAX_GREP_RESULTS);
    expect(capped.truncated).toBe(true);
    expect(capped.note).toContain('narrower path');
    const exact = body(await grepTool.execute({ pattern: 'legacyFormat', maxResults: 2 }, context));
    expect(exact.matches).toHaveLength(2);
    expect(exact.truncated).toBe(false);
    const long = body(await grepTool.execute({ pattern: 'hit y' }, context)).matches[0] ?? '';
    expect(long.length).toBeLessThan(260);
    expect(long.endsWith('...')).toBe(true);
  });

  test('output goes through the registry redaction', async () => {
    writeFileSync(join(root, 'src', 'key.ts'), "const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';\n");
    const { registry, pathGuard, permissionPolicy } = createBuiltinRegistry(createConfig(root));
    const result = await registry.execute('grep', { pattern: 'const key' }, { projectRoot: root, pathGuard, permissionPolicy });
    expect(result.ok).toBe(true);
    expect(result.content).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
