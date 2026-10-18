import { describe, expect, test } from 'bun:test';
import type { ClientOptions } from 'openai';
import { createConfig } from '../../src/config/config';
import { buildResponsesInput, mapResponsesPayload, OpenAiResponsesProvider, type ResponsesClient, type ResponsesProviderOptions } from '../../src/llm/openai/responses-provider';
import type { LlmMessage, LlmRequest } from '../../src/llm/provider';
import { CodeLoopError } from '../../src/shared/errors';

// Everything here is offline: the real SDK client runs, but its fetch is a fake.
type FakeFetch = NonNullable<ClientOptions['fetch']>;

interface RecordedCall { url: string; body: Record<string, unknown>; headers: Headers }

const conversation: LlmMessage[] = [
  { role: 'system', content: 'You are CodeLoop.' },
  { role: 'user', content: 'Fix src/add.ts.' },
  {
    role: 'assistant',
    content: 'Reading both files.',
    toolCalls: [
      { id: 'call_a', name: 'read', arguments: { path: 'src/add.ts' } },
      { id: 'call_b', name: 'read', arguments: { path: 'tests/add.test.ts' } },
    ],
  },
  { role: 'tool', content: 'export const add = (a, b) => a - b;', toolCallId: 'call_a', name: 'read' },
  { role: 'tool', content: 'expect(add(1, 2)).toBe(3)', toolCallId: 'call_b', name: 'read' },
];

const request: LlmRequest = {
  messages: conversation,
  tools: [{ name: 'read', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
  maxOutputTokens: 512,
  reasoningEffort: 'low',
};

const payload = {
  id: 'resp_123',
  object: 'response',
  model: 'gpt-6-luna-2026-09-01',
  status: 'completed',
  output: [
    { type: 'reasoning', id: 'rs_1', summary: [] },
    { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Found the bug.', annotations: [] }] },
    { type: 'function_call', id: 'fc_1', call_id: 'call_c', name: 'edit', arguments: '{"path":"src/add.ts","oldText":"a - b","newText":"a + b"}', status: 'completed' },
    { type: 'function_call', id: 'fc_2', call_id: 'call_d', name: 'shell', arguments: '{"command":"bun test tests/add.test.ts"}', status: 'completed' },
  ],
  usage: { input_tokens: 1200, output_tokens: 80, total_tokens: 1280, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 16 } },
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function fakeFetch(responses: Array<() => Response>): { fetch: FakeFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FakeFetch = (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: new Headers(init?.headers) });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    if (!next) throw new Error('fake fetch has no response configured');
    return Promise.resolve(next());
  };
  return { fetch, calls };
}

function provider(options: ResponsesProviderOptions, providerTimeoutMs = 5_000): OpenAiResponsesProvider {
  return new OpenAiResponsesProvider({ ...createConfig(), providerTimeoutMs }, { apiKey: 'test-key', baseUrl: 'https://api.test/v1', model: 'gpt-6-luna', ...options });
}

async function rejection(promise: Promise<unknown>): Promise<CodeLoopError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodeLoopError) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('buildResponsesInput', () => {
  test('maps roles and pairs function_call with function_call_output by call_id', () => {
    expect(buildResponsesInput(conversation)).toEqual([
      { role: 'system', content: 'You are CodeLoop.' },
      { role: 'user', content: 'Fix src/add.ts.' },
      { role: 'assistant', content: 'Reading both files.' },
      { type: 'function_call', call_id: 'call_a', name: 'read', arguments: '{"path":"src/add.ts"}' },
      { type: 'function_call', call_id: 'call_b', name: 'read', arguments: '{"path":"tests/add.test.ts"}' },
      { type: 'function_call_output', call_id: 'call_a', output: 'export const add = (a, b) => a - b;' },
      { type: 'function_call_output', call_id: 'call_b', output: 'expect(add(1, 2)).toBe(3)' },
    ]);
  });

  test('omits the empty assistant text when the turn is only tool calls', () => {
    const input = buildResponsesInput([{ role: 'assistant', content: '', toolCalls: [{ id: 'call_x', name: 'read', arguments: {} }] }]);
    expect(input).toEqual([{ type: 'function_call', call_id: 'call_x', name: 'read', arguments: '{}' }]);
  });

  test('rejects a tool result that cannot be paired with a call', () => {
    expect(() => buildResponsesInput([{ role: 'tool', content: 'orphan' }])).toThrow(CodeLoopError);
  });
});

describe('mapResponsesPayload', () => {
  test('maps text, two function calls and usage', () => {
    const mapped = mapResponsesPayload(payload as unknown as Parameters<typeof mapResponsesPayload>[0]);
    expect(mapped).toEqual({
      text: 'Found the bug.',
      toolCalls: [
        { id: 'call_c', name: 'edit', arguments: { path: 'src/add.ts', oldText: 'a - b', newText: 'a + b' } },
        { id: 'call_d', name: 'shell', arguments: { command: 'bun test tests/add.test.ts' } },
      ],
      usage: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280 },
      provider: 'openai',
      model: 'gpt-6-luna-2026-09-01',
      requestId: 'resp_123',
    });
  });

  test('marks malformed function-call arguments with __invalidJson', () => {
    const broken = { ...payload, output: [{ type: 'function_call', id: 'fc_9', call_id: 'call_bad', name: 'edit', arguments: '{"path": "src/add.ts", "oldText": ' }] };
    const mapped = mapResponsesPayload(broken as unknown as Parameters<typeof mapResponsesPayload>[0]);
    expect(mapped.toolCalls).toEqual([{ id: 'call_bad', name: 'edit', arguments: { __invalidJson: '{"path": "src/add.ts", "oldText": ' } }]);
  });
});

describe('OpenAiResponsesProvider over the SDK', () => {
  test('sends a stateless Responses request with tools, limits and the mapped history', async () => {
    const fake = fakeFetch([() => json(200, payload)]);
    const response = await provider({ fetch: fake.fetch, maxRetries: 0 }).complete(request);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.url).toBe('https://api.test/v1/responses');
    expect(call.headers.get('authorization')).toBe('Bearer test-key');
    expect(call.body.model).toBe('gpt-6-luna');
    expect(call.body.store).toBe(false);
    expect(call.body.max_output_tokens).toBe(512);
    expect(call.body.reasoning).toEqual({ effort: 'low' });
    expect(call.body.tools).toEqual([{ type: 'function', name: 'read', description: 'Read a file.', parameters: request.tools[0]!.parameters, strict: false }]);
    expect(call.body.input).toEqual(buildResponsesInput(conversation));
    expect(response.toolCalls.map((toolCall) => toolCall.id)).toEqual(['call_c', 'call_d']);
    expect(response.usage.totalTokens).toBe(1280);
  });

  test('lets the SDK retry a 429 and returns the later success', async () => {
    // retry-after-ms: 0 makes the SDK skip its exponential backoff sleep, keeping the test fast.
    const fake = fakeFetch([() => json(429, { error: { message: 'Rate limit', type: 'requests' } }, { 'retry-after-ms': '0' }), () => json(200, payload)]);
    const response = await provider({ fetch: fake.fetch, maxRetries: 1 }).complete(request);
    expect(fake.calls).toHaveLength(2);
    expect(response.text).toBe('Found the bug.');
  });

  test('maps a 429 that outlasts the retries to PROVIDER_ERROR with status 429', async () => {
    const fake = fakeFetch([() => json(429, { error: { message: 'Rate limit', type: 'requests' } }, { 'retry-after-ms': '0' })]);
    const error = await rejection(provider({ fetch: fake.fetch, maxRetries: 1 }).complete(request));
    expect(fake.calls).toHaveLength(2);
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.details.status).toBe(429);
  });

  test('does not retry a 401 and maps it to PROVIDER_ERROR', async () => {
    const fake = fakeFetch([() => json(401, { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } }), () => json(200, payload)]);
    const error = await rejection(provider({ fetch: fake.fetch, maxRetries: 2 }).complete(request));
    expect(fake.calls).toHaveLength(1);
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.details.status).toBe(401);
    expect(error.details.code).toBe('invalid_api_key');
    expect(error.message).not.toContain('test-key');
  });

  test('reads the retry count from CODELOOP_PROVIDER_MAX_RETRIES', async () => {
    const previous = process.env.CODELOOP_PROVIDER_MAX_RETRIES;
    process.env.CODELOOP_PROVIDER_MAX_RETRIES = '0';
    try {
      const fake = fakeFetch([() => json(503, { error: { message: 'Overloaded' } }), () => json(200, payload)]);
      const error = await rejection(provider({ fetch: fake.fetch }).complete(request));
      expect(fake.calls).toHaveLength(1);
      expect(error.details.status).toBe(503);
    } finally {
      if (previous === undefined) delete process.env.CODELOOP_PROVIDER_MAX_RETRIES;
      else process.env.CODELOOP_PROVIDER_MAX_RETRIES = previous;
    }
  });

  test('maps the configured timeout to PROVIDER_TIMEOUT', async () => {
    const hanging: FakeFetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
    const error = await rejection(provider({ fetch: hanging, maxRetries: 0 }, 50).complete(request));
    expect(error.code).toBe('PROVIDER_TIMEOUT');
    expect(error.details.reason).toBe('timeout');
  });

  test('maps a caller abort to PROVIDER_TIMEOUT', async () => {
    const controller = new AbortController();
    const hanging: FakeFetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      setTimeout(() => controller.abort(), 10);
    });
    const error = await rejection(provider({ fetch: hanging, maxRetries: 2 }).complete(request, controller.signal));
    expect(error.code).toBe('PROVIDER_TIMEOUT');
    expect(error.details.reason).toBe('aborted');
  });

  test('passes the abort signal to an injected client', async () => {
    let seenSignal: AbortSignal | undefined;
    const client: ResponsesClient = {
      responses: {
        create(_body, options) {
          seenSignal = options?.signal;
          return Promise.resolve(payload as unknown as Awaited<ReturnType<ResponsesClient['responses']['create']>>);
        },
      },
    };
    const controller = new AbortController();
    await provider({ client }).complete(request, controller.signal);
    expect(seenSignal).toBe(controller.signal);
  });

  test('refuses to construct for a model without a price', () => {
    let caught: unknown;
    try {
      provider({ model: 'gpt-unpriced', maxRetries: 0 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodeLoopError);
    expect((caught as CodeLoopError).code).toBe('CONFIG_ERROR');
  });
});
