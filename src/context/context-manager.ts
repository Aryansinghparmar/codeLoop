import type { LlmMessage } from '../llm/provider';
import { estimateTokens } from '../shared/text';

/**
 * 'window': older messages were dropped, keeping pinned messages plus a recent window.
 * 'mask': old tool outputs were replaced by a short placeholder (the messages themselves stay).
 */
export type ContextStage = 'window' | 'mask';

export interface ContextReduction {
  messages: LlmMessage[];
  reduced: boolean;
  beforeTokens: number;
  afterTokens: number;
  removedMessages: number;
  maskedMessages: number;
  stages: ContextStage[];
}

export interface ContextManagerOptions {
  /** How many of the most recent messages the window stage keeps (before turn-boundary adjustment). */
  windowMessages?: number;
}

/**
 * Two-stage context compaction, run before every model call.
 *
 * Token counts are an ESTIMATE: characters / 4 over the JSON of the messages
 * (see estimateTokens). No tokenizer is used, and tool schemas are not counted.
 *
 * Invariant kept by both stages: every tool message keeps its parent assistant
 * message (the one whose toolCalls contain its id) and every assistant toolCall
 * keeps its tool result. The Responses API rejects requests that break this.
 */
export class ContextManager {
  private readonly windowMessages: number;

  public constructor(private readonly budgetTokens: number, options: ContextManagerOptions = {}) {
    this.windowMessages = options.windowMessages ?? 10;
  }

  public reduce(messages: LlmMessage[]): ContextReduction {
    const beforeTokens = countTokens(messages);
    if (beforeTokens <= this.budgetTokens) {
      return { messages, reduced: false, beforeTokens, afterTokens: beforeTokens, removedMessages: 0, maskedMessages: 0, stages: [] };
    }
    const stages: ContextStage[] = [];

    // Stage 1 "window": pinned messages + the most recent messages, cut at a turn boundary.
    let candidate = this.applyWindow(messages);
    if (candidate.length < messages.length) stages.push('window');

    // Stage 2 "mask": if still over budget, blank the oldest tool outputs one at a time.
    const masked = this.maskOldToolOutputs(candidate);
    if (masked.count > 0) {
      candidate = masked.messages;
      stages.push('mask');
    }

    // Soft cap: if nothing is left to mask (e.g. one huge user message), afterTokens can stay above the budget.
    return {
      messages: candidate,
      reduced: stages.length > 0,
      beforeTokens,
      afterTokens: countTokens(candidate),
      removedMessages: messages.length - candidate.length,
      maskedMessages: masked.count,
      stages,
    };
  }

  private applyWindow(messages: LlmMessage[]): LlmMessage[] {
    const firstSystem = messages.findIndex((message) => message.role === 'system');
    const firstUser = messages.findIndex((message) => message.role === 'user');
    const latestUser = messages.map((message) => message.role).lastIndexOf('user');
    const pinned = [firstSystem, firstUser, latestUser].filter((index) => index >= 0);

    let start = turnBoundaryAtOrBefore(messages, Math.max(0, messages.length - this.windowMessages));
    // Prefer the whole current turn (latest user message onwards) when it fits in the budget.
    if (latestUser >= 0 && latestUser < start) {
      const wholeTurn = keepFrom(messages, pinned, latestUser);
      if (countTokens(wholeTurn) <= this.budgetTokens) start = latestUser;
    }
    return keepFrom(messages, pinned, start);
  }

  private maskOldToolOutputs(messages: LlmMessage[]): { messages: LlmMessage[]; count: number } {
    const result = [...messages];
    let count = 0;
    for (let index = 0; index < result.length && countTokens(result) > this.budgetTokens; index += 1) {
      const message = result[index];
      if (!message || message.role !== 'tool') continue;
      const placeholder = `[older tool output removed to fit the context budget: ${message.content.length} chars]`;
      if (message.content.length <= placeholder.length) continue;
      // Replace the content but keep the message, so the call/result pair stays intact.
      result[index] = { ...message, content: placeholder };
      count += 1;
    }
    return { messages: result, count };
  }
}

function countTokens(messages: LlmMessage[]): number {
  return estimateTokens(JSON.stringify(messages));
}

/** Moves a cut point back until it does not land on a tool message, so the parent assistant call is kept. */
function turnBoundaryAtOrBefore(messages: LlmMessage[], index: number): number {
  let start = index;
  while (start > 0 && messages[start]?.role === 'tool') start -= 1;
  return start;
}

/** Keeps the pinned messages plus every message from `start` to the end, in their original order. */
function keepFrom(messages: LlmMessage[], pinned: number[], start: number): LlmMessage[] {
  return messages.filter((_, index) => index >= start || pinned.includes(index));
}
