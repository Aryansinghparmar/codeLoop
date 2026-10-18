import type { CodeLoopConfig } from '../config/config';
import { NativeProcessRunner } from '../infrastructure/process/native-process-runner';
import type { ProcessRunner } from '../infrastructure/process/process-runner';
import { truncateMiddle } from '../shared/text';
import { authorize, stringArg, type Tool } from './tool';

export function createShellTool(config: CodeLoopConfig, runner: ProcessRunner = new NativeProcessRunner()): Tool {
  return {
    definition: {
      name: 'shell',
      description: 'Run one local shell command in the project. Safe commands run automatically; other commands require approval.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' }, timeoutMs: { type: 'number' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
    async execute(args, context) {
      const command = stringArg(args, 'command');
      const blocked = await authorize(context, { action: 'shell', target: command });
      if (blocked) return blocked;
      const requestedTimeout = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : config.processTimeoutMs;
      const timeoutMs = Math.min(requestedTimeout, 300_000);
      const processOptions: { cwd: string; timeoutMs: number; signal?: AbortSignal } = { cwd: context.projectRoot, timeoutMs };
      if (context.signal) processOptions.signal = context.signal;
      const result = await runner.run(command, processOptions);
      const combined = [result.stdout, result.stderr ? `stderr:\n${result.stderr}` : ''].filter(Boolean).join('\n');
      const output = truncateMiddle(combined, config.shellOutputMaxChars);
      return {
        ok: result.exitCode === 0 && !result.timedOut,
        // Only the capped `output` goes to the model; the raw stdout/stderr would bypass shellOutputMaxChars.
        content: JSON.stringify({ exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, durationMs: result.durationMs, output: output.text, truncated: output.truncated }),
        truncated: output.truncated,
        metadata: { exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut },
      };
    },
  };
}
