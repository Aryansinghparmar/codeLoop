import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import type { ToolExecutionContext } from '../../src/tools/tool';
import { editTool } from '../../src/tools/edit';
import { writeTool } from '../../src/tools/write';
import { temporaryRoot, removeRoot } from '../helpers';

let root: string;
let context: ToolExecutionContext;

beforeEach(async () => {
  root = await temporaryRoot();
  const guard = new PathGuard(root);
  context = { projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard), approve: async () => true };
});

afterEach(async () => {
  await removeRoot(root);
});

describe('write tool', () => {
  test('reports created for a new file, including missing parent folders', async () => {
    const result = await writeTool.execute({ path: 'src/new/file.ts', content: 'hello\n' }, context);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ path: 'src/new/file.ts', bytes: 6, created: true, overwritten: false, previousBytes: 0 });
    expect(await readFile(join(root, 'src', 'new', 'file.ts'), 'utf8')).toBe('hello\n');
  });

  test('reports overwritten and the previous size for an existing file', async () => {
    await writeFile(join(root, 'notes.txt'), 'old content\n');
    const result = await writeTool.execute({ path: 'notes.txt', content: 'new\n' }, context);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ path: 'notes.txt', bytes: 4, created: false, overwritten: true, previousBytes: 12 });
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('new\n');
  });

  test('refuses to write over a directory', async () => {
    const result = await writeTool.execute({ path: '.', content: 'x' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('not a regular file');
  });
});

describe('write and edit refuse hard-linked files', () => {
  test('a hard link to .env can be neither overwritten nor edited', async () => {
    const linkRoot = await temporaryRoot();
    try {
      writeFileSync(join(linkRoot, '.env'), 'SECRET=keep-me\n');
      mkdirSync(join(linkRoot, 'src'));
      linkSync(join(linkRoot, '.env'), join(linkRoot, 'src', 'notes.txt'));
      const guard = new PathGuard(linkRoot);
      const linkContext: ToolExecutionContext = { projectRoot: linkRoot, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard), approve: async () => true };
      const written = await writeTool.execute({ path: 'src/notes.txt', content: 'SECRET=changed\n' }, linkContext);
      const edited = await editTool.execute({ path: 'src/notes.txt', oldText: 'keep-me', newText: 'changed' }, linkContext);
      expect(written.ok).toBe(false);
      expect(edited.ok).toBe(false);
      expect(readFileSync(join(linkRoot, '.env'), 'utf8')).toBe('SECRET=keep-me\n');
    } finally { await removeRoot(linkRoot); }
  });
});
