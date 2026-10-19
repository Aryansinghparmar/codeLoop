import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConfig } from '../../src/config/config';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { createBuiltinRegistry } from '../../src/tools/builtins';
import { MAX_LIST_ENTRIES, listTool } from '../../src/tools/list';
import { createReadTool } from '../../src/tools/read';
import type { ToolExecutionContext, ToolResult } from '../../src/tools/tool';
import { temporaryRoot, removeRoot } from '../helpers';

let base: string;
let root: string;
let context: ToolExecutionContext;

function linkDirectory(target: string, link: string): void {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function body(result: ToolResult): { entries: string[]; truncated: boolean; note?: string } {
  expect(result.ok).toBe(true);
  return JSON.parse(result.content);
}

beforeEach(async () => {
  base = realpathSync.native(await temporaryRoot());
  root = join(base, 'root');
  mkdirSync(join(root, 'src', 'cache'), { recursive: true });
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'src', 'cache', 'lru.ts'), 'export {};\n');
  writeFileSync(join(root, 'src', 'index.ts'), 'export {};\n');
  writeFileSync(join(root, 'README.md'), '# hi\n');
  writeFileSync(join(root, '.env'), 'SECRET=1\n');
  writeFileSync(join(root, '.env.example'), 'SECRET=\n');
  writeFileSync(join(root, '.git', 'config'), '[core]\n');
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '\n');
  const guard = new PathGuard(root);
  context = { projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard) };
});

afterEach(async () => {
  await removeRoot(base);
});

describe('list tool', () => {
  test('lists the project root: directories first, protected names marked, skipped directories not entered', async () => {
    const { entries, truncated } = body(await listTool.execute({}, context));
    // Protected entries are not classified further, so they sort with the files.
    expect(entries).toEqual(['node_modules/ (skipped)', 'src/', '.env (protected)', '.env.example', '.git (protected)', 'README.md']);
    expect(truncated).toBe(false);
  });

  test('recursive lists subdirectories with project-relative paths, but never inside protected or skipped ones', async () => {
    const { entries } = body(await listTool.execute({ path: '.', recursive: true }, context));
    expect(entries).toContain('src/cache/lru.ts');
    expect(entries).toContain('src/index.ts');
    expect(entries.some((entry) => entry.startsWith('.git/'))).toBe(false);
    expect(entries.some((entry) => entry.startsWith('node_modules/pkg'))).toBe(false);
  });

  test('marks <name>.env files and hides nothing else', async () => {
    writeFileSync(join(root, 'src', 'prod.env'), 'KEY=1\n');
    writeFileSync(join(root, 'src', '.npmrc'), '//registry/:_authToken=x\n');
    expect(body(await listTool.execute({ path: 'src' }, context)).entries).toEqual(['src/cache/', 'src/.npmrc (protected)', 'src/index.ts', 'src/prod.env (may hold secrets: grep skips it)']);
  });

  test('lists a subdirectory without recursing by default', async () => {
    expect(body(await listTool.execute({ path: 'src' }, context)).entries).toEqual(['src/cache/', 'src/index.ts']);
  });

  test('caps a recursive listing and says it was truncated', async () => {
    for (let index = 0; index < MAX_LIST_ENTRIES + 20; index += 1) writeFileSync(join(root, 'src', `f${String(index).padStart(3, '0')}.ts`), '');
    const capped = body(await listTool.execute({ recursive: true, maxEntries: 10_000 }, context));
    expect(capped.entries).toHaveLength(MAX_LIST_ENTRIES);
    expect(capped.truncated).toBe(true);
    expect(capped.note).toContain('List a subdirectory');
    expect(body(await listTool.execute({ path: 'src/cache', maxEntries: 1 }, context)).truncated).toBe(false);
  });

  test('does not follow a junction or symlink out of the root or into .git', async () => {
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'secret.txt'), 'x');
    linkDirectory(join(base, 'outside'), join(root, 'src', 'escape'));
    linkDirectory(join(root, '.git'), join(root, 'src', 'gitlink'));
    linkDirectory(join(root, 'src'), join(root, 'src', 'loop'));
    const { entries } = body(await listTool.execute({ recursive: true }, context));
    expect(entries).toContain('src/escape (protected)');
    expect(entries).toContain('src/gitlink (protected)');
    expect(entries).toContain('src/loop (link, not followed)');
    expect(entries.some((entry) => entry.includes('secret.txt') || entry.includes('config'))).toBe(false);
  });

  test('refuses paths outside the root and protected directories', async () => {
    const { registry, pathGuard, permissionPolicy } = createBuiltinRegistry(createConfig(root));
    const tools = { projectRoot: root, pathGuard, permissionPolicy };
    for (const path of ['..', '../root2', '.git']) {
      const result = await registry.execute('list', { path }, tools);
      expect(result.ok).toBe(false);
      expect(result.content).toMatch(/outside the project root|protected/u);
    }
  });

  test('says when the path is a file or missing', async () => {
    expect((await listTool.execute({ path: 'README.md' }, context)).content).toContain('use read');
    expect((await listTool.execute({ path: 'nope' }, context)).content).toContain('does not exist');
  });

  test('read on a directory points to list', async () => {
    const result = await createReadTool(createConfig(root)).execute({ path: 'src' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Use the list tool');
  });
});
