import type { LlmProvider, LlmRequest, LlmResponse } from './provider';

export type MockResponseFactory = (request: LlmRequest, callIndex: number) => LlmResponse | Promise<LlmResponse>;

export class MockProvider implements LlmProvider {
  public readonly name = 'mock';
  private callIndex = 0;

  public constructor(private readonly factory: MockResponseFactory) {}

  public complete(request: LlmRequest): Promise<LlmResponse> {
    const index = this.callIndex++;
    return Promise.resolve(this.factory(request, index));
  }
}

export function textResponse(text: string): LlmResponse {
  return {
    text,
    toolCalls: [],
    usage: {},
    provider: 'mock',
    model: 'mock-model',
  };
}
