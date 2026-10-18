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

async function runShell(command: string, approve?: () => Promise<boolean>) {
  const root = await temporaryRoot();
  try {
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'tests', 'pass.test.ts'), "import { test, expect } from 'bun:test';\ntest('pass', () => expect(1).toBe(1));\n", 'utf8');
    const config = createConfig(root);
    const builtins = createBuiltinRegistry(config, fakeProcessRunner);
    return await builtins.registry.execute('shell', { command }, {
      projectRoot: root,
      pathGuard: builtins.pathGuard,
      permissionPolicy: builtins.permissionPolicy,
      ...(approve ? { approve } : {}),
    });
  } finally { await removeRoot(root); }
}

describe('shell tool', () => {
  // `bun test` runs agent-written code, so it is a confirm-tier command.
  test('runs bun test once the user approves it', async () => {
    const result = await runShell('bun test tests/pass.test.ts', async () => true);
    expect(result.ok).toBe(true);
  });

  test('rejects bun test when no approver is available', async () => {
    const result = await runShell('bun test tests/pass.test.ts');
    expect(result.ok).toBe(false);
    expect(result.content).toContain('rejected');
  });

  test('runs an allow-tier command without asking', async () => {
    const result = await runShell('git status');
    expect(result.ok).toBe(true);
  });
});

describe('shell output cap', () => {
  test('the model never receives more than shellOutputMaxChars of command output', async () => {
    const huge = 'x'.repeat(50_000);
    const root = await temporaryRoot();
    try {
      const config = createConfig(root);
      const runner = { async run() { return { stdout: huge, stderr: huge, exitCode: 0, signal: null, timedOut: false as const, durationMs: 1 }; } };
      const builtins = createBuiltinRegistry(config, runner);
      const result = await builtins.registry.execute('shell', { command: 'git status' }, { projectRoot: root, pathGuard: builtins.pathGuard, permissionPolicy: builtins.permissionPolicy });
      const parsed = JSON.parse(result.content) as Record<string, unknown>;
      expect(parsed.stdout).toBeUndefined();
      expect(parsed.stderr).toBeUndefined();
      expect(parsed.truncated).toBe(true);
      expect(result.content.length).toBeLessThan(config.shellOutputMaxChars + 500);
    } finally { await removeRoot(root); }
  });
});
