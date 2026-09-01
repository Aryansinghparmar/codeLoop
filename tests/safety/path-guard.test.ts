import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PathGuard } from '../../src/permissions/path-guard';
import { temporaryRoot, removeRoot } from '../helpers';

describe('path guard', () => {
  test('allows project files and the example environment file', async () => {
    const root = await temporaryRoot();
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, '.env.example'), 'OPENAI_API_KEY=\n');
      const guard = new PathGuard(root);
      expect(guard.resolveInside('src/index.ts')).toBe(join(root, 'src', 'index.ts'));
      expect(guard.isHardDenied(join(root, '.env.example'))).toBe(false);
    } finally { await removeRoot(root); }
  });

  test('denies secrets and outside paths', async () => {
    const root = await temporaryRoot();
    try {
      const guard = new PathGuard(root);
      expect(() => guard.resolveInside('.env')).toThrow();
      expect(() => guard.resolveInside('..')).toThrow();
      expect(() => guard.resolveInside('src/../.ssh/config')).toThrow();
    } finally { await removeRoot(root); }
  });
});
