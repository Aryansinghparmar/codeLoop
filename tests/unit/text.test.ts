import { describe, expect, test } from 'bun:test';
import { estimateTokens, truncateMiddle } from '../../src/shared/text';

describe('text limits', () => {
  test('keeps short output unchanged', () => {
    expect(truncateMiddle('hello', 10).text).toBe('hello');
    expect(truncateMiddle('hello', 10).truncated).toBe(false);
  });

  test('preserves both ends of large output', () => {
    const result = truncateMiddle('start-' + 'x'.repeat(100) + '-end', 30);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('start-')).toBe(true);
    expect(result.text.endsWith('-end')).toBe(true);
  });

  test('estimates tokens conservatively', () => {
    expect(estimateTokens('12345678')).toBe(2);
  });
});
