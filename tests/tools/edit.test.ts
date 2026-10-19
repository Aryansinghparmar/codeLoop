import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { editTool } from '../../src/tools/edit';
import type { ToolExecutionContext } from '../../src/tools/tool';
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

describe('edit tool', () => {
  test('applies one exact replacement', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'value.ts'), 'const value = 1;\n');
    const result = await editTool.execute({ path: 'src/value.ts', oldText: 'value = 1', newText: 'value = 2' }, context);
    expect(result.ok).toBe(true);
    expect(await readFile(join(root, 'src', 'value.ts'), 'utf8')).toBe('const value = 2;\n');
  });

  test.each(['$&', "$'", '$`', '$$', '$1', "price = '$' + cost; // $& $$"])('writes %p literally (no String.replace patterns)', async (newText) => {
    await writeFile(join(root, 'value.ts'), 'before OLD after\n');
    const result = await editTool.execute({ path: 'value.ts', oldText: 'OLD', newText }, context);
    expect(result.ok).toBe(true);
    expect(await readFile(join(root, 'value.ts'), 'utf8')).toBe(`before ${newText} after\n`);
  });

  test('matches LF oldText against a CRLF file and keeps CRLF endings', async () => {
    await writeFile(join(root, 'crlf.ts'), 'line one\r\nline two\r\nline three\r\n');
    const result = await editTool.execute({ path: 'crlf.ts', oldText: 'line one\nline two', newText: 'first\nsecond' }, context);
    expect(result.ok).toBe(true);
    expect(await readFile(join(root, 'crlf.ts'), 'utf8')).toBe('first\r\nsecond\r\nline three\r\n');
  });

  test('reports zero matches with a re-read hint and line numbers', async () => {
    await writeFile(join(root, 'value.ts'), 'const a = 1;\nconst b = 2;\n');
    const result = await editTool.execute({ path: 'value.ts', oldText: 'const b = 2;\nconst c = 3;', newText: 'x' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('not found');
    expect(result.content).toContain('Re-read the file');
    expect(result.content).toContain('line 2');
  });

  test('reports the number of matches when oldText is ambiguous', async () => {
    await writeFile(join(root, 'value.ts'), 'value value\n');
    const result = await editTool.execute({ path: 'value.ts', oldText: 'value', newText: 'changed' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('occurs 2 times');
    expect(result.content).toContain('more surrounding lines');
    expect(await readFile(join(root, 'value.ts'), 'utf8')).toBe('value value\n');
  });

  test('lists the line of each occurrence, including one far down a CRLF file', async () => {
    const lines = Array.from({ length: 620 }, (_, index) => `const line${index + 1} = ${index + 1};`);
    for (const lineNumber of [1, 5, 615]) lines[lineNumber - 1] = `legacyFormat(${lineNumber});`;
    await writeFile(join(root, 'payroll.ts'), `${lines.join('\r\n')}\r\n`);
    const result = await editTool.execute({ path: 'payroll.ts', oldText: 'legacyFormat(', newText: 'formatMoney(' }, context);
    expect(result.content).toContain('occurs 3 times in payroll.ts (starting on lines 1, 5, 615)');
  });

  test('caps the occurrence lines at ten', async () => {
    await writeFile(join(root, 'many.ts'), 'x\n'.repeat(12));
    const result = await editTool.execute({ path: 'many.ts', oldText: 'x', newText: 'y' }, context);
    expect(result.content).toContain('occurs 12 times in many.ts (starting on lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...)');
  });

  test('rejects a no-op edit', async () => {
    await writeFile(join(root, 'value.ts'), 'same\n');
    const result = await editTool.execute({ path: 'value.ts', oldText: 'same', newText: 'same' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('no change');
  });

  test('explains a missing file without leaking the absolute path', async () => {
    const result = await editTool.execute({ path: 'missing.ts', oldText: 'a', newText: 'b' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('does not exist; use write to create it');
    expect(result.content).not.toContain(root);
  });
});
