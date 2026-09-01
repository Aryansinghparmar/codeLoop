import { spawn } from 'node:child_process';
import type { ProcessResult, ProcessRunner } from './process-runner';

export class NativeProcessRunner implements ProcessRunner {
  public run(command: string, options: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const child = isWindows
        ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: options.cwd, windowsHide: true })
        : spawn('sh', ['-c', command], { cwd: options.cwd });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const finish = (result: ProcessResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const terminate = (): void => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
      };
      const timer = setTimeout(terminate, options.timeoutMs);
      const onAbort = (): void => {
        timedOut = true;
        child.kill('SIGTERM');
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        finish({ stdout, stderr, exitCode, signal, timedOut, durationMs: Date.now() - started });
      });
    });
  }
}
