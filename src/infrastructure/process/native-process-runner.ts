import { spawn, type ChildProcess } from 'node:child_process';
import type { ProcessResult, ProcessRunner } from './process-runner';

const IS_WINDOWS = process.platform === 'win32';
const KILL_GRACE_MS = 1_000;

// Only what shells, git and bun need to start. Everything else (notably API keys loaded from .env) stays out.
const ENV_ALLOWLIST = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'BUN_INSTALL', 'NODE_ENV', 'TERM', 'LANG',
]);
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/iu;

/** Builds the child environment from an allowlist; names are compared upper-cased because Windows ignores case. */
export function childEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && ENV_ALLOWLIST.has(name.toUpperCase()) && !SECRET_NAME.test(name)) env[name] = value;
  }
  return env;
}

// Killing only the shell would leave its children (e.g. a hung `bun test`) running and holding the output pipes.
function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (IS_WINDOWS) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).once('error', () => {});
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process group has already exited.
  }
}

export class NativeProcessRunner implements ProcessRunner {
  public run(command: string, options: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const env = childEnvironment();
      const child = IS_WINDOWS
        ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: options.cwd, env, windowsHide: true })
        // detached makes the shell a process-group leader, so the whole group can be killed at once.
        : spawn('sh', ['-c', command], { cwd: options.cwd, env, detached: true });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const terminate = (): void => {
        if (timedOut) return;
        timedOut = true;
        killProcessTree(child, 'SIGTERM');
        setTimeout(() => { if (!settled) killProcessTree(child, 'SIGKILL'); }, KILL_GRACE_MS).unref();
      };
      const timer = setTimeout(terminate, options.timeoutMs);
      options.signal?.addEventListener('abort', terminate, { once: true });
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.once('error', (error) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', terminate);
        reject(error);
      });
      child.once('close', (exitCode, signal) => {
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', terminate);
        resolve({ stdout, stderr, exitCode, signal, timedOut, durationMs: Date.now() - started });
      });
    });
  }
}
