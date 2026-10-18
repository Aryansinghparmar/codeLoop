import { describe, expect, test } from 'bun:test';
import { ContextManager } from '../../src/context/context-manager';
import type { LlmMessage } from '../../src/llm/provider';
import { estimateTokens } from '../../src/shared/text';
import { assertPairsIntact } from './pairs';

const BUDGET = 32_000;

function toolPairs(prefix: string, count: number, outputChars: number): LlmMessage[] {
  const messages: LlmMessage[] = [];
  for (let index = 1; index <= count; index += 1) {
    const id = `${prefix}${index}`;
    messages.push({ role: 'assistant', content: '', toolCalls: [{ id, name: 'read', arguments: { path: `src/${id}.ts` } }] });
    messages.push({ role: 'tool', content: 'x'.repeat(outputChars), toolCallId: id, name: 'read' });
  }
  return messages;
}

function tokens(messages: LlmMessage[]): number {
  return estimateTokens(JSON.stringify(messages));
}

describe('context manager', () => {
  test('single turn over budget: applies the window and lands under budget', () => {
    const messages: LlmMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'task' }, ...toolPairs('c', 18, 16_000)];
    const result = new ContextManager(BUDGET).reduce(messages);
    expect(result.reduced).toBe(true);
    expect(result.stages).toEqual(['window']);
    expect(result.afterTokens).toBeLessThanOrEqual(BUDGET);
    expect(result.messages.map((message) => message.role).slice(0, 2)).toEqual(['system', 'user']);
    assertPairsIntact(result.messages);
  });

  test('multi turn: keeps the latest user message, not only the first one', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'FIRST task' },
      ...toolPairs('a', 6, 16_000),
      { role: 'assistant', content: 'done first' },
      { role: 'user', content: 'SECOND task (current)' },
      ...toolPairs('b', 6, 16_000),
    ];
    const result = new ContextManager(BUDGET).reduce(messages);
    const users = result.messages.filter((message) => message.role === 'user').map((message) => message.content);
    expect(users).toEqual(['FIRST task', 'SECOND task (current)']);
    expect(result.afterTokens).toBeLessThanOrEqual(BUDGET);
    assertPairsIntact(result.messages);
  });

  test('multi turn where the current turn is too big: latest user message is still pinned', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'FIRST task' },
      { role: 'assistant', content: 'done first' },
      { role: 'user', content: 'SECOND task (current)' },
      ...toolPairs('b', 18, 16_000),
    ];
    const result = new ContextManager(BUDGET).reduce(messages);
    expect(result.messages.some((message) => message.content === 'SECOND task (current)')).toBe(true);
    expect(result.afterTokens).toBeLessThanOrEqual(BUDGET);
    assertPairsIntact(result.messages);
  });

  test('a window that would start on a tool message is moved back to its parent call', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      ...toolPairs('k', 9, 16_000),
      { role: 'assistant', content: 'thinking' },
    ];
    // The last 10 messages start on tool(k5); the old code kept it without assistant[k5].
    expect(messages[messages.length - 10]?.role).toBe('tool');
    const result = new ContextManager(BUDGET).reduce(messages);
    assertPairsIntact(result.messages);
    expect(result.messages.some((message) => message.toolCallId === 'k5')).toBe(true);
    expect(result.afterTokens).toBeLessThanOrEqual(BUDGET);
  });

  test('an odd custom window size never splits a call from its output', () => {
    const messages: LlmMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'task' }, ...toolPairs('w', 12, 8_000)];
    for (const windowMessages of [1, 3, 5, 7]) {
      const result = new ContextManager(4_000, { windowMessages }).reduce(messages);
      assertPairsIntact(result.messages);
    }
  });

  test('window still over budget: masks old tool outputs, keeps every message, pairs intact', () => {
    const messages: LlmMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'task' }, ...toolPairs('d', 3, 60_000)];
    const result = new ContextManager(BUDGET).reduce(messages);
    expect(result.stages).toEqual(['mask']);
    expect(result.messages.length).toBe(messages.length);
    expect(result.removedMessages).toBe(0);
    expect(result.maskedMessages).toBeGreaterThan(0);
    expect(result.afterTokens).toBeLessThanOrEqual(BUDGET);
    expect(result.messages.find((message) => message.toolCallId === 'd1')?.content).toBe('[older tool output removed to fit the context budget: 60000 chars]');
    assertPairsIntact(result.messages);
  });

  test('under budget: returns the messages unchanged', () => {
    const messages: LlmMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'task' }, ...toolPairs('u', 2, 100)];
    const result = new ContextManager(BUDGET).reduce(messages);
    expect(result.reduced).toBe(false);
    expect(result.stages).toEqual([]);
    expect(result.messages).toBe(messages);
    expect(result.afterTokens).toBe(tokens(messages));
  });
});
