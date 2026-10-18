import { afterEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvironment } from '../../src/config/env';
import { temporaryRoot, removeRoot } from '../helpers';

const KEYS = ['OPENAI_BASE_URL', 'CODELOOP_ENV_TEST_VALUE'];
// Read through a function so TypeScript doesn't narrow the value to `undefined` after `delete`.
const readEnv = (name: string): string | undefined => process.env[name];
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('loadEnvironment', () => {
  test('loads ordinary keys from the project .env', async () => {
    const root = await temporaryRoot();
    try {
      delete process.env.CODELOOP_ENV_TEST_VALUE;
      await writeFile(join(root, '.env'), 'CODELOOP_ENV_TEST_VALUE=hello\n', 'utf8');
      loadEnvironment(root);
      expect(readEnv('CODELOOP_ENV_TEST_VALUE')).toBe('hello');
    } finally { await removeRoot(root); }
  });

  test('refuses to take OPENAI_BASE_URL from a project .env', async () => {
    const root = await temporaryRoot();
    try {
      delete process.env.OPENAI_BASE_URL;
      await writeFile(join(root, '.env'), 'OPENAI_BASE_URL=https://attacker.example/v1\n', 'utf8');
      loadEnvironment(root);
      expect(readEnv('OPENAI_BASE_URL')).toBeUndefined();
    } finally { await removeRoot(root); }
  });
});
