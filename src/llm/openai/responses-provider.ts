import { CodeLoopError } from '../../shared/errors';
import type { CodeLoopConfig } from '../../config/config';
import type { LlmProvider, LlmRequest, LlmResponse } from '../provider';
import { parseJsonObject } from '../provider';

interface ResponsesProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAiResponsesProvider implements LlmProvider {
  public readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  public constructor(config: CodeLoopConfig, options: ResponsesProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/u, '');
    this.defaultModel = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
    this.timeoutMs = config.providerTimeoutMs;
  }

  public async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    if (!this.apiKey) throw new CodeLoopError('CONFIG_ERROR', 'OPENAI_API_KEY is not set.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          input: buildResponsesInput(request.messages),
          tools: request.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          })),
          max_output_tokens: request.maxOutputTokens,
          reasoning: request.reasoningEffort ? { effort: request.reasoningEffort } : undefined,
          store: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CodeLoopError('PROVIDER_ERROR', `OpenAI request failed with HTTP ${response.status}.`, {
          status: response.status,
          body: await response.text(),
        });
      }
      const payload = await response.json() as OpenAiResponsesPayload;
      return mapResponsesPayload(payload, request.model ?? this.defaultModel);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CodeLoopError('PROVIDER_TIMEOUT', 'OpenAI request timed out or was cancelled.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function buildResponsesInput(messages: LlmRequest['messages']): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.content) input.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
      }
      continue;
    }
    input.push({ role: message.role, content: message.content });
  }
  return input;
}

interface OpenAiResponsesPayload {
  id?: string;
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
    name?: string;
    call_id?: string;
    arguments?: string;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

function mapResponsesPayload(payload: OpenAiResponsesPayload, fallbackModel: string): LlmResponse {
  const textParts: string[] = [];
  const toolCalls: LlmResponse['toolCalls'] = [];
  for (const item of payload.output ?? []) {
    if (item.type === 'message') {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text' && content.text) textParts.push(content.text);
      }
    }
    if (item.type === 'function_call' && item.name && item.call_id) {
      toolCalls.push({ id: item.call_id, name: item.name, arguments: parseJsonObject(item.arguments ?? '{}') });
    }
  }
  return {
    text: textParts.join('\n'),
    toolCalls,
    usage: {
      inputTokens: payload.usage?.input_tokens,
      outputTokens: payload.usage?.output_tokens,
      totalTokens: payload.usage?.total_tokens,
    },
    provider: 'openai',
    model: payload.model ?? fallbackModel,
    requestId: payload.id,
  };
}
