import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfig } from '../../src/config/config';
import { createBuiltinRegistry } from '../../src/tools/builtins';
import { temporaryRoot, removeRoot } from '../helpers';

const fakeProcessRunner = {
  async run(): Promise<{ stdout: string; stderr: string; exitCode: number; signal: null; timedOut: false; durationMs: number }> {
    return { stdout: '1.3.10', stderr: '', exitCode: 0, signal: null, timedOut: false, durationMs: 1 };
  },
};

describe('shell tool', () => {
  test('runs a safe Bun test command', async () => {
    const root = await temporaryRoot();
    try {
      await mkdir(join(root, 'tests'), { recursive: true });
      await writeFile(join(root, 'tests', 'pass.test.ts'), "import { test, expect } from 'bun:test';\ntest('pass', () => expect(1).toBe(1));\n", 'utf8');
      const config = createConfig(root);
      const builtins = createBuiltinRegistry(config, fakeProcessRunner);
      const result = await builtins.registry.execute('shell', { command: 'bun test tests/pass.test.ts' }, { projectRoot: root, pathGuard: builtins.pathGuard, permissionPolicy: builtins.permissionPolicy });
      expect(result.ok).toBe(true);
    } finally { await removeRoot(root); }
  });
});
