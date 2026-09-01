import { CodeLoopError } from '../../shared/errors';
import type { CodeLoopConfig } from '../../config/config';
import type { LlmProvider, LlmRequest, LlmResponse } from '../provider';
import { parseJsonObject } from '../provider';

export interface NvidiaProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class NvidiaNimChatProvider implements LlmProvider {
  public readonly name = 'nvidia-nim';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  public constructor(config: CodeLoopConfig, options: NvidiaProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.NVIDIA_API_KEY ?? '';
    this.baseUrl = (options.baseUrl ?? process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1').replace(/\/$/u, '');
    this.defaultModel = options.model ?? process.env.NVIDIA_MODEL ?? 'poolside/laguna-xs-2.1';
    this.timeoutMs = config.providerTimeoutMs;
  }

  public async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    if (!this.apiKey) throw new CodeLoopError('CONFIG_ERROR', 'NVIDIA_API_KEY is not set.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
            ...(message.toolCalls?.length ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            } : {}),
          })),
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          temperature: 0.2,
          top_p: 0.7,
          max_tokens: request.maxOutputTokens ?? 4_096,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = response.status === 503
          ? 'NVIDIA NIM is temporarily unavailable or its worker capacity is full.'
          : `NVIDIA NIM request failed with HTTP ${response.status}.`;
        throw new CodeLoopError('PROVIDER_ERROR', message, {
          status: response.status,
          body: await response.text(),
        });
      }
      const payload = await response.json() as NvidiaChatPayload;
      return mapNvidiaPayload(payload, request.model ?? this.defaultModel);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CodeLoopError('PROVIDER_TIMEOUT', 'NVIDIA NIM request timed out or was cancelled.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

interface NvidiaChatPayload {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function mapNvidiaPayload(payload: NvidiaChatPayload, fallbackModel: string): LlmResponse {
  const message = payload.choices?.[0]?.message;
  return {
    text: message?.content ?? '',
    toolCalls: (message?.tool_calls ?? []).flatMap((call) => {
      if (!call.id || !call.function?.name) return [];
      return [{ id: call.id, name: call.function.name, arguments: parseJsonObject(call.function.arguments ?? '{}') }];
    }),
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens,
    },
    provider: 'nvidia-nim',
    model: payload.model ?? fallbackModel,
    requestId: payload.id,
  };
}
