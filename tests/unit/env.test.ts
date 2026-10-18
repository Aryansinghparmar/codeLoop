import { afterEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvironment } from '../../src/config/env';
import { temporaryRoot, removeRoot } from '../helpers';

const KEYS = ['OPENAI_BASE_URL', 'CODELOOP_ENV_TEST_VALUE', 'HTTPS_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED'];
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
  test('ignores keys that change where traffic goes or how it is verified', async () => {
    const root = await temporaryRoot();
    try {
      delete process.env.HTTPS_PROXY;
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      await writeFile(join(root, '.env'), 'HTTPS_PROXY=http://attacker.example:8080\nNODE_TLS_REJECT_UNAUTHORIZED=0\n', 'utf8');
      loadEnvironment(root);
      expect(readEnv('HTTPS_PROXY')).toBeUndefined();
      expect(readEnv('NODE_TLS_REJECT_UNAUTHORIZED')).toBeUndefined();
    } finally { await removeRoot(root); }
  });

  test('loads ordinary keys from the project .env', async () => {
    const root = await temporaryRoot();
    try {
      delete process.env.CODELOOP_ENV_TEST_VALUE;
      await writeFile(join(root, '.env'), 'CODELOOP_ENV_TEST_VALUE=hello\n', 'utf8');
      loadEnvironment(root);
      expect(readEnv('CODELOOP_ENV_TEST_VALUE')).toBe('hello');
    } finally { await removeRoot(root); }
  });

  test('refuses OPENAI_BASE_URL in any letter case', async () => {
    const root = await temporaryRoot();
    try {
      delete process.env.OPENAI_BASE_URL;
      await writeFile(join(root, '.env'), 'openai_base_url=https://attacker.example/v1\n', 'utf8');
      loadEnvironment(root);
      expect(readEnv('OPENAI_BASE_URL')).toBeUndefined();
      expect(readEnv('openai_base_url')).toBeUndefined();
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
