import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodeLoopConfig } from '../config/config';
import { AgentLoop, type AgentRunResult } from '../agent/agent-loop';
import type { LlmProvider } from '../llm/provider';
import { createBuiltinRegistry } from '../tools/builtins';
import { fixedTasks } from './fixed-tasks';
import type { BenchmarkTask, EvaluationResult } from './types';
import { calculateCost } from './metrics';
import type { ProcessRunner } from '../infrastructure/process/process-runner';
import { redactSecrets } from '../shared/redact';

const offlineProcessRunner = {
  async run(): Promise<{ stdout: string; stderr: string; exitCode: number; signal: null; timedOut: false; durationMs: number }> {
    return { stdout: 'offline process result', stderr: '', exitCode: 0, signal: null, timedOut: false, durationMs: 1 };
  },
};

export class EvaluationRunner {
  public constructor(private readonly baseConfig: CodeLoopConfig) {}

  public async run(provider: LlmProvider, tasks: BenchmarkTask[] = fixedTasks, processRunner: ProcessRunner = offlineProcessRunner): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    let suiteCostUsd = 0;
    for (const task of tasks) {
      const remainingSuiteBudgetUsd = this.baseConfig.liveSuiteBudgetUsd - suiteCostUsd;
      if (remainingSuiteBudgetUsd <= 0) {
        results.push(toSkippedResult(task, provider));
        continue;
      }
      const root = await mkdtemp(join(tmpdir(), 'codeloop-eval-'));
      const trace: string[] = [];
      try {
        await task.setup(root);
        const config = {
          ...this.baseConfig,
          projectRoot: root,
          liveTaskBudgetUsd: Math.min(this.baseConfig.liveTaskBudgetUsd, remainingSuiteBudgetUsd),
        };
        const builtins = createBuiltinRegistry(config, processRunner);
        const loop = new AgentLoop(config, provider, builtins.registry, builtins.pathGuard, builtins.permissionPolicy);
        const run = await loop.run(task.prompt, {
          approve: async () => false,
          onToolCall: (call) => trace.push(`call ${call.name} ${redactSecrets(JSON.stringify(call.arguments)).slice(0, 300)}`),
          onToolResult: (call, result) => trace.push(`${result.ok ? 'ok' : 'fail'} ${call.name}: ${redactSecrets(result.content).slice(0, 240)}`),
        });
        const assertions = await task.assert(root);
        const cost = calculateCost(run.provider, run.model, { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, totalTokens: run.usage.totalTokens });
        if (cost.costUsd !== undefined) suiteCostUsd += cost.costUsd;
        results.push(toResult(task, run, assertions, cost.costUsd, trace));
      } catch (error) {
        const failed = toFailedResult(task, provider, error, trace);
        if (failed.estimatedCostUsd !== undefined) suiteCostUsd += failed.estimatedCostUsd;
        results.push(failed);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    return results;
  }
}

function emptyUsage(): Pick<EvaluationResult, 'durationMs' | 'steps' | 'toolCalls' | 'failedToolCalls' | 'recoveredFailures' | 'reductions' | 'inputTokens' | 'outputTokens' | 'totalTokens'> {
  return { durationMs: 0, steps: 0, toolCalls: 0, failedToolCalls: 0, recoveredFailures: 0, reductions: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function toSkippedResult(task: BenchmarkTask, provider: LlmProvider): EvaluationResult {
  return {
    taskId: task.id,
    provider: provider.name,
    model: 'not-started',
    passed: false,
    valid: false,
    ...emptyUsage(),
    assertionDetails: [],
    toolTrace: [],
    error: 'Task skipped because the live suite budget was reached.',
  };
}

export function toResult(
  task: BenchmarkTask,
  run: AgentRunResult,
  assertions: { passed: boolean; details: string[] },
  costUsd: number | undefined,
  trace: string[],
): EvaluationResult {
  return {
    taskId: task.id,
    provider: run.provider,
    model: run.model,
    passed: assertions.passed,
    valid: true,
    durationMs: run.durationMs,
    steps: run.steps,
    toolCalls: run.toolCalls,
    failedToolCalls: run.failedToolCalls,
    recoveredFailures: run.recoveredFailures,
    reductions: run.reductions,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    totalTokens: run.usage.totalTokens,
    ...(costUsd !== undefined ? { estimatedCostUsd: costUsd } : {}),
    assertionDetails: assertions.details,
    toolTrace: trace,
  };
}

/** Builds a result from an AgentLoop failure; the loop puts its counters in `error.details`. */
export function toFailedResult(task: BenchmarkTask, provider: LlmProvider, error: unknown, trace: string[]): EvaluationResult {
  const details = error instanceof Error && 'details' in error && error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {};
  return {
    taskId: task.id,
    provider: typeof details.provider === 'string' ? details.provider : provider.name,
    model: typeof details.model === 'string' ? details.model : 'unknown',
    passed: false,
    valid: false,
    durationMs: numeric(details.durationMs),
    steps: numeric(details.steps),
    toolCalls: numeric(details.toolCalls),
    failedToolCalls: numeric(details.failedToolCalls),
    recoveredFailures: numeric(details.recoveredFailures),
    reductions: numeric(details.reductions),
    inputTokens: numeric(details.inputTokens),
    outputTokens: numeric(details.outputTokens),
    totalTokens: numeric(details.totalTokens),
    ...(typeof details.estimatedCostUsd === 'number' ? { estimatedCostUsd: details.estimatedCostUsd } : {}),
    assertionDetails: [],
    toolTrace: trace,
    error: error instanceof Error ? error.message : String(error),
  };
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
