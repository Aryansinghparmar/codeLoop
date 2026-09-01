import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { editTool } from '../../src/tools/edit';
import { temporaryRoot, removeRoot } from '../helpers';

describe('edit tool', () => {
  test('applies one exact replacement', async () => {
    const root = await temporaryRoot();
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'value.ts'), 'const value = 1;\n');
      const guard = new PathGuard(root);
      const result = await editTool.execute({ path: 'src/value.ts', oldText: 'value = 1', newText: 'value = 2' }, {
        projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard), approve: async () => true,
      });
      expect(result.ok).toBe(true);
      expect(await readFile(join(root, 'src', 'value.ts'), 'utf8')).toBe('const value = 2;\n');
    } finally { await removeRoot(root); }
  });

  test('rejects a stale or repeated match', async () => {
    const root = await temporaryRoot();
    try {
      await writeFile(join(root, 'value.ts'), 'value value\n');
      const guard = new PathGuard(root);
      const result = await editTool.execute({ path: 'value.ts', oldText: 'value', newText: 'changed' }, { projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard) });
      expect(result.ok).toBe(false);
      expect(result.content).toContain('more than once');
    } finally { await removeRoot(root); }
  });
});
