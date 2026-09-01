import type { LlmMessage } from '../llm/provider';
import { estimateTokens } from '../shared/text';

export interface ContextReduction {
  messages: LlmMessage[];
  reduced: boolean;
  beforeTokens: number;
  afterTokens: number;
  removedMessages: number;
}

export class ContextManager {
  public constructor(private readonly budgetTokens: number) {}

  public reduce(messages: LlmMessage[]): ContextReduction {
    const beforeTokens = estimateTokens(JSON.stringify(messages));
    if (beforeTokens <= this.budgetTokens) return { messages, reduced: false, beforeTokens, afterTokens: beforeTokens, removedMessages: 0 };
    const system = messages.filter((message) => message.role === 'system').slice(0, 1);
    const user = messages.filter((message) => message.role === 'user').slice(0, 1);
    const recent = messages.slice(-10);
    const retained = deduplicateMessages([...system, ...user, ...recent]);
    let candidate = retained;
    while (estimateTokens(JSON.stringify(candidate)) > this.budgetTokens && candidate.length > 3) {
      const index = candidate.findIndex((message) => message.role === 'tool');
      if (index < 0) break;
      const message = candidate[index];
      if (!message) break;
      candidate = [...candidate.slice(0, index), { ...message, content: '[older tool output compacted]' }, ...candidate.slice(index + 1)];
      if (estimateTokens(JSON.stringify(candidate)) <= this.budgetTokens) break;
      candidate = candidate.filter((_, messageIndex) => messageIndex !== index);
    }
    const afterTokens = estimateTokens(JSON.stringify(candidate));
    return { messages: candidate, reduced: true, beforeTokens, afterTokens, removedMessages: Math.max(0, messages.length - candidate.length) };
  }
}

function deduplicateMessages(messages: LlmMessage[]): LlmMessage[] {
  const result: LlmMessage[] = [];
  const seen = new Set<LlmMessage>();
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    result.push(message);
  }
  return result;
}
