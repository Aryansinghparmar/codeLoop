import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfig } from '../../src/config/config';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { createReadTool, MAX_READ_BYTES } from '../../src/tools/read';
import type { Tool, ToolExecutionContext } from '../../src/tools/tool';
import { temporaryRoot, removeRoot } from '../helpers';

let root: string;
let context: ToolExecutionContext;
let readTool: Tool;

beforeEach(async () => {
  root = await temporaryRoot();
  const guard = new PathGuard(root);
  context = { projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard) };
  readTool = createReadTool(createConfig(root));
});

afterEach(async () => {
  await removeRoot(root);
});

describe('read tool', () => {
  test('returns numbered lines, the selected range and totalLines', async () => {
    await writeFile(join(root, 'lines.txt'), 'one\r\ntwo\r\nthree\r\nfour\r\n');
    const result = await readTool.execute({ path: 'lines.txt', startLine: 2, endLine: 3 }, context);
    expect(result.ok).toBe(true);
    const body = JSON.parse(result.content);
    expect(body).toMatchObject({ path: 'lines.txt', startLine: 2, endLine: 3, totalLines: 4, truncated: false });
    expect(body.text).toBe('    2| two\n    3| three');
  });

  test('clamps endLine to the last line and does not count a trailing newline as a line', async () => {
    await writeFile(join(root, 'lines.txt'), 'a\nb\n');
    const body = JSON.parse((await readTool.execute({ path: 'lines.txt', endLine: 99 }, context)).content);
    expect(body).toMatchObject({ startLine: 1, endLine: 2, totalLines: 2 });
  });

  test('says when a file is empty', async () => {
    await writeFile(join(root, 'empty.txt'), '');
    const result = await readTool.execute({ path: 'empty.txt' }, context);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ path: 'empty.txt', totalLines: 0, text: 'File is empty.' });
  });

  test('refuses a binary file', async () => {
    await writeFile(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const result = await readTool.execute({ path: 'image.png' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('binary file');
  });

  test('refuses an oversized file before reading it', async () => {
    await writeFile(join(root, 'big.txt'), 'x'.repeat(MAX_READ_BYTES + 1));
    const result = await readTool.execute({ path: 'big.txt' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('read limit');
  });

  test('reports a missing file without the absolute path', async () => {
    const result = await readTool.execute({ path: 'missing.txt' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Read failed: missing.txt does not exist.');
  });

  test('asks the approver on a confirm decision instead of denying outright', async () => {
    await writeFile(join(root, 'notes.txt'), 'hi\n');
    const confirmPolicy = { evaluate: () => ({ decision: 'confirm' as const, reason: 'needs a human' }) };
    const rejected = await readTool.execute({ path: 'notes.txt' }, { ...context, permissionPolicy: confirmPolicy });
    expect(rejected.ok).toBe(false);
    expect(rejected.content).toContain('no approver is available');
    const approved = await readTool.execute({ path: 'notes.txt' }, { ...context, permissionPolicy: confirmPolicy, approve: async () => true });
    expect(approved.ok).toBe(true);
  });
});
