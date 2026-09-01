export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
}

export interface ProcessRunner {
  run(command: string, options: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult>;
}
