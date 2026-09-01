import type { LlmProvider, LlmRequest, LlmResponse, LlmToolCall } from './provider';

export class ScriptedCodingProvider implements LlmProvider {
  public readonly name = 'mock-scripted';

  public complete(request: LlmRequest): Promise<LlmResponse> {
    const prompt = request.messages.find((message) => message.role === 'user')?.content ?? '';
    const previousCalls = request.messages.flatMap((message) => message.toolCalls ?? []);
    const next = this.nextCall(prompt, previousCalls.length);
    if (!next) return Promise.resolve({ text: 'Task completed.', toolCalls: [], usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, provider: this.name, model: 'scripted-model' });
    return Promise.resolve({ text: '', toolCalls: [next], usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 }, provider: this.name, model: 'scripted-model' });
  }

  private nextCall(prompt: string, index: number): LlmToolCall | undefined {
    if (prompt.includes('src/greet.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t1-${index}`, name: 'write', arguments: { path: 'src/greet.ts', content: 'export function greet(name: string): string { return `Hello, ${name}!`; }\n' } },
        { id: `t1-${index}`, name: 'write', arguments: { path: 'tests/greet.test.ts', content: "import { test, expect } from 'bun:test';\nimport { greet } from '../src/greet';\ntest('greets', () => expect(greet('Aryan')).toBe('Hello, Aryan!'));\n" } },
        { id: `t1-${index}`, name: 'shell', arguments: { command: 'bun test tests/greet.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/add.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t2-${index}`, name: 'edit', arguments: { path: 'src/add.ts', oldText: 'return a - b', newText: 'return a + b' } },
        { id: `t2-${index}`, name: 'shell', arguments: { command: 'bun test tests/add.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/count.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t3-${index}`, name: 'edit', arguments: { path: 'src/count.ts', oldText: 'i); }', newText: 'i + 1); }' } },
        { id: `t3-${index}`, name: 'shell', arguments: { command: 'bun test tests/count.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('formatUser')) {
      const calls: LlmToolCall[] = [
        { id: `t4-${index}`, name: 'edit', arguments: { path: 'src/profile.ts', oldText: 'formatUser', newText: 'formatProfile' } },
        { id: `t4-${index}`, name: 'edit', arguments: { path: 'tests/profile.test.ts', oldText: "formatUser } from '../src/profile';\ntest('formats', () => expect(formatUser", newText: "formatProfile } from '../src/profile';\ntest('formats', () => expect(formatProfile" } },
        { id: `t4-${index}`, name: 'shell', arguments: { command: 'bun test tests/profile.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/multiply.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t7-${index}`, name: 'write', arguments: { path: 'src/multiply.ts', content: 'export function multiply(a: number, b: number): number { return a * b; }\n' } },
        { id: `t7-${index}`, name: 'write', arguments: { path: 'tests/multiply.test.ts', content: "import { test, expect } from 'bun:test';\nimport { multiply } from '../src/multiply';\ntest('multiplies', () => expect(multiply(4, 5)).toBe(20));\n" } },
        { id: `t7-${index}`, name: 'shell', arguments: { command: 'bun test tests/multiply.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/is-even.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t8-${index}`, name: 'edit', arguments: { path: 'src/is-even.ts', oldText: 'n % 2 === 1', newText: 'n % 2 === 0' } },
        { id: `t8-${index}`, name: 'shell', arguments: { command: 'bun test tests/is-even.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/upper.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t9-${index}`, name: 'write', arguments: { path: 'src/upper.ts', content: 'export function upper(value: string): string { return value.toUpperCase(); }\n' } },
        { id: `t9-${index}`, name: 'write', arguments: { path: 'tests/upper.test.ts', content: "import { test, expect } from 'bun:test';\nimport { upper } from '../src/upper';\ntest('uppercases', () => expect(upper('hello')).toBe('HELLO'));\n" } },
        { id: `t9-${index}`, name: 'shell', arguments: { command: 'bun test tests/upper.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/max.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t10-${index}`, name: 'edit', arguments: { path: 'src/max.ts', oldText: 'Math.min', newText: 'Math.max' } },
        { id: `t10-${index}`, name: 'shell', arguments: { command: 'bun test tests/max.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('formatLabel')) {
      const calls: LlmToolCall[] = [
        { id: `t11-${index}`, name: 'edit', arguments: { path: 'src/label.ts', oldText: 'formatLabel', newText: 'formatDisplayLabel' } },
        { id: `t11-${index}`, name: 'edit', arguments: { path: 'tests/label.test.ts', oldText: "formatLabel } from '../src/label';\ntest('formats labels', () => expect(formatLabel", newText: "formatDisplayLabel } from '../src/label';\ntest('formats labels', () => expect(formatDisplayLabel" } },
        { id: `t11-${index}`, name: 'shell', arguments: { command: 'bun test tests/label.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/is-palindrome.ts')) {
      const calls: LlmToolCall[] = [
        { id: `t12-${index}`, name: 'write', arguments: { path: 'src/is-palindrome.ts', content: 'export function isPalindrome(value: string): boolean { return value === value.split(\'\').reverse().join(\'\'); }\n' } },
        { id: `t12-${index}`, name: 'write', arguments: { path: 'tests/is-palindrome.test.ts', content: "import { test, expect } from 'bun:test';\nimport { isPalindrome } from '../src/is-palindrome';\ntest('checks palindromes', () => expect(isPalindrome('level')).toBe(true));\n" } },
        { id: `t12-${index}`, name: 'shell', arguments: { command: 'bun test tests/is-palindrome.test.ts' } },
      ];
      return calls[index];
    }
    if (prompt.includes('src/missing.txt')) {
      const calls: LlmToolCall[] = [
        { id: `t5-${index}`, name: 'read', arguments: { path: 'src/missing.txt' } },
        { id: `t5-${index}`, name: 'read', arguments: { path: 'src/recovery.txt' } },
      ];
      return calls[index];
    }
    if (prompt.includes('Remove-Item')) {
      const calls: LlmToolCall[] = [
        { id: `t6-${index}`, name: 'read', arguments: { path: '.env' } },
        { id: `t6-${index}`, name: 'shell', arguments: { command: 'Remove-Item src/recovery.txt' } },
      ];
      return calls[index];
    }
    return undefined;
  }
}
