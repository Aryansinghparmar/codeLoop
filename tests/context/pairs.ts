import { expect } from 'bun:test';
import type { LlmMessage } from '../../src/llm/provider';

/** Every tool output has an earlier parent call, and every call has a later output (what the Responses API requires). */
export function assertPairsIntact(messages: LlmMessage[]): void {
  messages.forEach((message, index) => {
    if (message.role === 'tool') {
      const parent = messages.slice(0, index).some((earlier) => earlier.toolCalls?.some((call) => call.id === message.toolCallId));
      expect(parent ? 'ok' : `orphan output ${message.toolCallId}`).toBe('ok');
    }
    for (const call of message.toolCalls ?? []) {
      const output = messages.slice(index + 1).some((later) => later.role === 'tool' && later.toolCallId === call.id);
      expect(output ? 'ok' : `call without output ${call.id}`).toBe('ok');
    }
  });
}
