export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  model?: string;
  maxOutputTokens?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface LlmUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  estimatedCostUsd?: number | undefined;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  provider: string;
  model: string;
  requestId?: string | undefined;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

export function toolDefinitionToOpenAiFunction(tool: LlmToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}

export const INVALID_JSON_KEY = '__invalidJson';

// Contract: returns the parsed JSON object; empty input means no arguments ({}); anything else (bad JSON, arrays, primitives) returns { __invalidJson: '<first 200 chars>' } so the caller can tell the model.
export function parseJsonObject(value: string): Record<string, unknown> {
  if (value.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through to the invalid marker.
  }
  return { [INVALID_JSON_KEY]: value.slice(0, 200) };
}
