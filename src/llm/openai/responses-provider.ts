import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, type ClientOptions } from 'openai';
import type { FunctionTool, Response as ResponsesApiResponse, ResponseCreateParamsNonStreaming, ResponseInputItem } from 'openai/resources/responses/responses';
import { CodeLoopError } from '../../shared/errors';
import type { CodeLoopConfig } from '../../config/config';
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmToolDefinition } from '../provider';
import { parseJsonObject } from '../provider';
import { requireProviderPrice } from '../pricing';

export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
const DEFAULT_MAX_RETRIES = 2;

// The only part of the SDK client the adapter uses, so tests can pass a fake.
export interface ResponsesClient {
  responses: {
    create(body: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<ResponsesApiResponse>;
  };
}

export interface ResponsesProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  /** Test seam: replaces the whole SDK client. */
  client?: ResponsesClient;
  /** Test seam: keeps the real SDK client (retries, timeouts, error classes) but swaps its HTTP layer. */
  fetch?: ClientOptions['fetch'];
}

export class OpenAiResponsesProvider implements LlmProvider {
  public readonly name = 'openai';
  public readonly model: string;
  private readonly client: ResponsesClient;

  public constructor(config: CodeLoopConfig, options: ResponsesProviderOptions = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    // Fail at startup, before any paid request, rather than after the first response comes back unpriced.
    requireProviderPrice(this.model);
    if (options.client) {
      this.client = options.client;
      return;
    }
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new CodeLoopError('CONFIG_ERROR', 'OPENAI_API_KEY is not set.');
    const clientOptions: ClientOptions = {
      apiKey,
      baseURL: options.baseUrl ?? process.env.OPENAI_BASE_URL ?? null,
      timeout: config.providerTimeoutMs,
      maxRetries: options.maxRetries ?? maxRetriesFromEnv(),
    };
    if (options.fetch) clientOptions.fetch = options.fetch;
    this.client = new OpenAI(clientOptions);
  }

  public async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const model = request.model ?? this.model;
    const body: ResponseCreateParamsNonStreaming = {
      model,
      input: buildResponsesInput(request.messages),
      tools: request.tools.map(toFunctionTool),
      // Stateless: nothing is kept server-side and the full history is sent every turn.
      // previous_response_id (with store: true) would avoid resending it; a possible optimisation.
      store: false,
      ...(request.maxOutputTokens !== undefined ? { max_output_tokens: request.maxOutputTokens } : {}),
      ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    };
    try {
      const response = await this.client.responses.create(body, signal ? { signal } : undefined);
      return mapResponsesPayload(response);
    } catch (error) {
      throw toCodeLoopError(error);
    }
  }
}

export function buildResponsesInput(messages: LlmMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId) throw new CodeLoopError('PROVIDER_ERROR', 'A tool result has no toolCallId, so it cannot be paired with its function call.');
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      continue;
    }
    if (message.content || !message.toolCalls?.length) input.push({ role: message.role, content: message.content });
    for (const call of message.toolCalls ?? []) {
      input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
    }
  }
  return input;
}

export function mapResponsesPayload(response: Pick<ResponsesApiResponse, 'id' | 'model' | 'output' | 'usage'>): LlmResponse {
  const textParts: string[] = [];
  const toolCalls: LlmResponse['toolCalls'] = [];
  for (const item of response.output) {
    if (item.type === 'message') {
      for (const content of item.content) {
        if (content.type === 'output_text' && content.text) textParts.push(content.text);
        if (content.type === 'refusal' && content.refusal) textParts.push(content.refusal);
      }
    }
    if (item.type === 'function_call') {
      toolCalls.push({ id: item.call_id, name: item.name, arguments: parseJsonObject(item.arguments) });
    }
  }
  return {
    text: textParts.join('\n'),
    toolCalls,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      totalTokens: response.usage?.total_tokens,
    },
    provider: 'openai',
    model: response.model,
    requestId: response.id,
  };
}

function toFunctionTool(tool: LlmToolDefinition): FunctionTool {
  return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false };
}

// The SDK has already retried what it considers transient by the time an error reaches us.
function toCodeLoopError(error: unknown): unknown {
  if (error instanceof CodeLoopError) return error;
  // Order matters: APIConnectionTimeoutError extends APIConnectionError, and both extend APIError.
  if (error instanceof APIUserAbortError) return new CodeLoopError('PROVIDER_TIMEOUT', 'OpenAI request was cancelled.', { reason: 'aborted' });
  if (error instanceof APIConnectionTimeoutError) return new CodeLoopError('PROVIDER_TIMEOUT', 'OpenAI request timed out.', { reason: 'timeout' });
  if (error instanceof APIConnectionError) return new CodeLoopError('PROVIDER_ERROR', `Could not reach OpenAI: ${error.message}`, { reason: 'connection' });
  if (error instanceof APIError) {
    return new CodeLoopError('PROVIDER_ERROR', `OpenAI request failed with HTTP ${error.status}: ${error.message}`, {
      status: error.status,
      code: error.code,
      type: error.type,
      requestId: error.requestID,
    });
  }
  return error;
}

function maxRetriesFromEnv(): number {
  const raw = process.env.CODELOOP_PROVIDER_MAX_RETRIES;
  const value = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MAX_RETRIES;
}
