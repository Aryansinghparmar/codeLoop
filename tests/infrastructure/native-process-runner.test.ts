import { afterEach, describe, expect, test } from 'bun:test';
import { childEnvironment, NativeProcessRunner } from '../../src/infrastructure/process/native-process-runner';
import { removeRoot, temporaryRoot } from '../helpers';

const isWindows = process.platform === 'win32';
const printVariable = (name: string): string => (isWindows ? `echo $env:${name}` : `echo $${name}`);

describe('child environment', () => {
  test.each([
    ['PATH', true],
    ['Path', true],
    ['SystemRoot', true],
    ['HOME', true],
    ['TEMP', true],
    ['OPENAI_API_KEY', false],
    ['GITHUB_TOKEN', false],
    ['AWS_SECRET_ACCESS_KEY', false],
    ['DB_PASSWORD', false],
    ['SOME_OTHER_VAR', false],
  ])('%s passed to the child: %p', (name, expected) => {
    expect(name in childEnvironment({ [name]: 'value' })).toBe(expected);
  });
});

describe('native process runner', () => {
  const runner = new NativeProcessRunner();
  let root = '';

  afterEach(async () => {
    delete process.env.FAKE_API_KEY;
    if (root) await removeRoot(root);
    root = '';
  });

  test('does not leak secret environment variables to the shell', async () => {
    root = await temporaryRoot();
    process.env.FAKE_API_KEY = 'sk-should-not-leak';
    const secret = await runner.run(printVariable('FAKE_API_KEY'), { cwd: root, timeoutMs: 30_000 });
    expect(secret.exitCode).toBe(0);
    expect(secret.stdout.trim()).toBe('');
    // Control: an allowlisted variable still reaches the child, so the empty output above is meaningful.
    const path = await runner.run(printVariable('PATH'), { cwd: root, timeoutMs: 30_000 });
    expect(path.stdout.trim()).not.toBe('');
  }, 60_000);

  test('times out and kills the whole process tree', async () => {
    root = await temporaryRoot();
    // The shell starts a grandchild that keeps the output pipe open; only a tree kill ends it quickly.
    const command = isWindows
      ? 'powershell.exe -NoProfile -Command Start-Sleep -Seconds 30'
      : 'sleep 30 & wait';
    const result = await runner.run(command, { cwd: root, timeoutMs: 1_500 });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(10_000);
  }, 30_000);

  test('stops the process tree when the abort signal fires', async () => {
    root = await temporaryRoot();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_000);
    const command = isWindows ? 'Start-Sleep -Seconds 30' : 'sleep 30';
    const result = await runner.run(command, { cwd: root, timeoutMs: 60_000, signal: controller.signal });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(10_000);
  }, 30_000);
});
