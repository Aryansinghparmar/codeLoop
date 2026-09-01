import { createConfig } from '../config/config';
import { ContextManager } from '../context/context-manager';
import type { LlmMessage } from '../llm/provider';
import { estimateTokens } from '../shared/text';

export interface ContextBenchmarkResult {
  fixture: string;
  contextBudgetTokens: number;
  messageCountBefore: number;
  messageCountAfter: number;
  beforeTokens: number;
  afterTokens: number;
  reductionTokens: number;
  reductionPercent: number;
  removedMessages: number;
  reduced: boolean;
}

export function runContextBenchmark(): ContextBenchmarkResult {
  const config = createConfig(process.cwd());
  const messages = createStressMessages();
  const manager = new ContextManager(config.contextBudgetTokens);
  const beforeTokens = estimateTokens(JSON.stringify(messages));
  const reduction = manager.reduce(messages);
  const reductionTokens = Math.max(0, reduction.beforeTokens - reduction.afterTokens);
  return {
    fixture: '18 tool results at approximately 16,000 characters each',
    contextBudgetTokens: config.contextBudgetTokens,
    messageCountBefore: messages.length,
    messageCountAfter: reduction.messages.length,
    beforeTokens,
    afterTokens: reduction.afterTokens,
    reductionTokens,
    reductionPercent: beforeTokens ? (reductionTokens / beforeTokens) * 100 : 0,
    removedMessages: reduction.removedMessages,
    reduced: reduction.reduced,
  };
}

function createStressMessages(): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: 'system', content: 'You are CodeLoop. Work only inside the project.' },
    { role: 'user', content: 'Review the results from the local tools and continue the task.' },
  ];
  const largeResult = 'tool output line: local test and file inspection result\n'.repeat(285);
  for (let index = 1; index <= 18; index += 1) {
    const callId = `stress-${index}`;
    messages.push({ role: 'assistant', content: `Tool step ${index} completed.`, toolCalls: [{ id: callId, name: 'read', arguments: { path: `src/file-${index}.ts` } }] });
    messages.push({ role: 'tool', content: `${largeResult}result number ${index}`, toolCallId: callId, name: 'read' });
  }
  return messages;
}
