import { describe, expect, test } from 'bun:test';
import { parseJsonObject } from '../../src/llm/provider';

describe('parseJsonObject', () => {
  test('returns a parsed JSON object', () => {
    expect(parseJsonObject('{"path":"src/a.ts","count":2}')).toEqual({ path: 'src/a.ts', count: 2 });
  });

  test('treats empty arguments as no arguments', () => {
    expect(parseJsonObject('')).toEqual({});
  });

  test('marks malformed JSON instead of silently returning {}', () => {
    expect(parseJsonObject('{"path": "src/a.ts"')).toEqual({ __invalidJson: '{"path": "src/a.ts"' });
  });

  test('marks valid JSON that is not an object', () => {
    expect(parseJsonObject('["src/a.ts"]')).toEqual({ __invalidJson: '["src/a.ts"]' });
    expect(parseJsonObject('null')).toEqual({ __invalidJson: 'null' });
  });

  test('keeps only the first 200 characters of the bad input', () => {
    const bad = '{' + 'x'.repeat(500);
    expect(parseJsonObject(bad).__invalidJson).toBe(bad.slice(0, 200));
  });
});
