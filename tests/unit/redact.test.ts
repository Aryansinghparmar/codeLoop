import { describe, expect, test } from 'bun:test';
import { redactSecrets } from '../../src/shared/redact';

const OPENAI_KEY = 'sk-abcdefghijklmnopqrstuvwx0123';
const PROJECT_KEY = 'sk-proj-ABCdef123456_ghiJKL-7890xyz';
const HEX = '0123456789abcdef0123456789abcdef';

describe('redactSecrets', () => {
  test('keeps the variable name and does not insert the match offset', () => {
    expect(redactSecrets(`OPENAI_API_KEY   ${OPENAI_KEY}`)).toBe('OPENAI_API_KEY   [REDACTED]');
    expect(redactSecrets(`prefix text OPENAI_API_KEY=${OPENAI_KEY}`)).toBe('prefix text OPENAI_API_KEY=[REDACTED]');
    expect(redactSecrets(`some words before ${OPENAI_KEY}`)).toBe('some words before [REDACTED]');
  });

  test('redacts SERPER and other generic *_API_KEY / *_TOKEN / *_SECRET / *_PASSWORD values', () => {
    expect(redactSecrets(`SERPER_API_KEY   ${HEX}`)).toBe('SERPER_API_KEY   [REDACTED]');
    expect(redactSecrets('SERPER_API_KEY=abc123')).toBe('SERPER_API_KEY=[REDACTED]');
    expect(redactSecrets('GITHUB_TOKEN: abc123')).toBe('GITHUB_TOKEN: [REDACTED]');
    expect(redactSecrets('AZURE_CLIENT_SECRET="s3cr3t"')).toBe('AZURE_CLIENT_SECRET="[REDACTED]"');
    expect(redactSecrets('{"DB_PASSWORD": "hunter2"}')).toBe('{"DB_PASSWORD": "[REDACTED]"}');
  });

  test('redacts vendor tokens wherever they appear', () => {
    expect(redactSecrets(`key ${PROJECT_KEY} end`)).toBe('key [REDACTED] end');
    expect(redactSecrets('nvapi-ABCDEFGHIJKLMNOPQRSTUVWX')).toBe('[REDACTED]');
    expect(redactSecrets('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')).toBe('token [REDACTED]');
    expect(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature')).toBe('Authorization: Bearer [REDACTED]');
  });

  test('leaves ordinary text untouched', () => {
    const samples = [
      'const value = 2;',
      'Set OPENAI_API_KEY in your .env file first.',
      'The bearer of bad news keeps a token in a secret place.',
      'task-runner and risk-free are not keys',
      'OPENAI_MODEL=gpt-5',
      'Completed in 3 steps.',
    ];
    for (const sample of samples) expect(redactSecrets(sample)).toBe(sample);
  });

  test('never leaves digits from a replacer offset next to the marker', () => {
    const text = `line one\nOPENAI_API_KEY ${OPENAI_KEY}\nNVIDIA_API_KEY nvapi-ABCDEFGHIJKLMNOPQRSTUVWX\n`;
    expect(redactSecrets(text)).not.toMatch(/\d\[REDACTED\]/u);
  });
});
