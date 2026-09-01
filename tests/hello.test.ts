import { hello } from '../src/hello';
import { describe, it, expect } from 'bun:test';

describe('hello', () => {
  it('should return Hello, <name>!', () => {
    expect(hello('World')).toBe('Hello, World!');
  });

  it('should work with different names', () => {
    expect(hello('Alice')).toBe('Hello, Alice!');
    expect(hello('Bob')).toBe('Hello, Bob!');
  });
});