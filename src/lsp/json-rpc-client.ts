export interface LspTransport {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params: Record<string, unknown>): void;
  close(): Promise<void>;
}

export class LspClient {
  public constructor(private readonly transport: LspTransport) {}

  public definition(params: Record<string, unknown>): Promise<unknown> {
    return this.transport.request('textDocument/definition', params);
  }

  public references(params: Record<string, unknown>): Promise<unknown> {
    return this.transport.request('textDocument/references', params);
  }

  public close(): Promise<void> {
    return this.transport.close();
  }
}
