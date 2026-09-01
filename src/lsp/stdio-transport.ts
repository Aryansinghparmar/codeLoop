import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createCodeLoopError } from '../shared/errors';
import type { LspTransport } from './json-rpc-client';

export class StdioLspTransport implements LspTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly buffer = { value: Buffer.alloc(0) };
  private nextId = 1;

  public constructor(command: string, args: string[] = [], cwd = process.cwd()) {
    const parts = command.trim().split(/\s+/u);
    const executable = parts.shift();
    if (!executable) throw createCodeLoopError('CONFIG_ERROR', 'LSP command is empty.');
    this.child = spawn(executable, [...parts, ...args], { cwd, windowsHide: true });
    this.child.stdout.on('data', (chunk: Buffer) => this.read(chunk));
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', () => this.rejectAll(new Error('LSP process exited.')));
  }

  public request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const pending = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.write({ jsonrpc: '2.0', id, method, params });
    return pending;
  }

  public notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  public async close(): Promise<void> {
    if (!this.child.killed) this.child.kill();
  }

  private write(value: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private read(chunk: Buffer): void {
    this.buffer.value = Buffer.concat([this.buffer.value, chunk]);
    while (true) {
      const headerEnd = this.buffer.value.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.value.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match?.[1]) {
        this.buffer.value = this.buffer.value.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.value.length < start + length) return;
      const body = this.buffer.value.subarray(start, start + length).toString('utf8');
      this.buffer.value = this.buffer.value.subarray(start + length);
      this.handle(body);
    }
  }

  private handle(body: string): void {
    try {
      const response = JSON.parse(body) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof response.id !== 'number') return;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error.message ?? 'LSP request failed.'));
      else request.resolve(response.result);
    } catch {
      // Ignore malformed diagnostic data from an external server.
    }
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
