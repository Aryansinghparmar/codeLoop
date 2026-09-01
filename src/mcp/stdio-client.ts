import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CodeLoopError } from '../shared/errors';
import type { JsonRpcRequest, JsonRpcResponse, McpClient, McpToolDefinition } from './protocol';

export class StdioMcpClient implements McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;

  public constructor(command: string, args: string[] = [], cwd = process.cwd()) {
    const parts = command.trim().split(/\s+/u);
    const executable = parts.shift();
    if (!executable) throw new CodeLoopError('CONFIG_ERROR', 'MCP command is empty.');
    this.child = spawn(executable, [...parts, ...args], { cwd, windowsHide: true });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.stderr.on('data', () => undefined);
  }

  public async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request('tools/list', {}) as { tools?: McpToolDefinition[] };
    return result.tools ?? [];
  }

  public async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: arguments_ });
  }

  public async close(): Promise<void> {
    if (!this.child.killed) this.child.kill();
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const pending = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
    return pending;
  }

  private handleLine(line: string): void {
    try {
      const response = JSON.parse(line) as JsonRpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new CodeLoopError('TOOL_ERROR', response.error.message, { code: response.error.code }));
      else pending.resolve(response.result);
    } catch {
      // Ignore non-JSON diagnostic lines from an MCP server.
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
