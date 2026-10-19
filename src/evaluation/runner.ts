import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodeLoopConfig } from '../config/config';
import { AgentLoop, type AgentRunResult } from '../agent/agent-loop';
import type { LlmProvider } from '../llm/provider';
import { createBuiltinRegistry } from '../tools/builtins';
import { fixedTasks } from './fixed-tasks';
import type { BenchmarkTask, EvalSuite, EvaluationResult, StopReason } from './types';
import { calculateCost } from './metrics';
import type { ProcessRunner } from '../infrastructure/process/process-runner';
import { redactSecrets } from '../shared/redact';
import { runGraderTests, type GraderTestResult } from './grader';
import { agentRanTests } from './trace-analysis';
import { approveEvalRequest } from './approval';

const offlineProcessRunner = {
  async run(): Promise<{ stdout: string; stderr: string; exitCode: number; signal: null; timedOut: false; durationMs: number }> {
    return { stdout: 'offline process result', stderr: '', exitCode: 0, signal: null, timedOut: false, durationMs: 1 };
  },
};

export interface EvaluationRunOptions {
  /**
   * Runs the grader's own `bun test` after each task. Live CLIs pass a
   * NativeProcessRunner; the offline suite leaves it out, so its results say
   * `testsExecuted: false` and are graded on file assertions only.
   */
  graderRunner?: ProcessRunner;
  /** Written into every result row (with the step limit), so stored JSONL says which suite it came from. */
  suite?: EvalSuite;
}

/** The agent stops that end a run without a crash: the workspace is still graded. */
const AGENT_STOPS: readonly StopReason[] = ['step-limit', 'repeated-failure', 'task-budget'];

interface AgentStop {
  reason: StopReason;
  message: string;
  details: Record<string, unknown>;
}

/** Reads the stop reason that AgentLoop puts in CodeLoopError.details; undefined for any other error. */
export function agentStopOf(error: unknown): AgentStop | undefined {
  const details = errorDetails(error);
  const reason = details.stopReason;
  if (typeof reason !== 'string' || !AGENT_STOPS.includes(reason as StopReason)) return undefined;
  return { reason: reason as StopReason, message: error instanceof Error ? error.message : String(error), details };
}

export class EvaluationRunner {
  public constructor(private readonly baseConfig: CodeLoopConfig) {}

  public async run(provider: LlmProvider, tasks: BenchmarkTask[] = fixedTasks, processRunner: ProcessRunner = offlineProcessRunner, options: EvaluationRunOptions = {}): Promise<EvaluationResult[]> {
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
      // The trace keeps only the start of each line, so secrets are looked for in the full text here.
      const canaries = task.secretCanaries ?? [];
      let secretLeaked = false;
      const watch = (text: string): void => {
        if (canaries.some((canary) => text.includes(canary))) secretLeaked = true;
      };
      try {
        await task.setup(root);
        const config = {
          ...this.baseConfig,
          projectRoot: root,
          liveTaskBudgetUsd: Math.min(this.baseConfig.liveTaskBudgetUsd, remainingSuiteBudgetUsd),
        };
        const builtins = createBuiltinRegistry(config, processRunner);
        const loop = new AgentLoop(config, provider, builtins.registry, builtins.pathGuard, builtins.permissionPolicy);
        let run: AgentRunResult | undefined;
        let stop: AgentStop | undefined;
        try {
          run = await loop.run(task.prompt, {
            approve: approveEvalRequest,
            onToolCall: (call) => {
              const args = JSON.stringify(call.arguments);
              watch(args);
              trace.push(`call ${call.name} ${redactSecrets(args).slice(0, 300)}`);
            },
            onToolResult: (call, result) => {
              watch(result.content);
              trace.push(`${result.ok ? 'ok' : 'fail'} ${call.name}: ${redactSecrets(result.content).slice(0, 240)}`);
            },
          });
        } catch (error) {
          stop = agentStopOf(error);
          if (!stop) throw error;
        }
        // Graded the same way whether the agent finished or was stopped: finished work must not be thrown away.
        const assertions = await task.assert(root, { trace, secretLeaked });
        const tests = await runGraderTests(task, root, options.graderRunner);
        if (run) {
          const cost = calculateCost(run.provider, run.model, { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, totalTokens: run.usage.totalTokens });
          if (cost.costUsd !== undefined) suiteCostUsd += cost.costUsd;
          results.push(toResult(task, run, assertions, tests, cost.costUsd, trace));
        } else if (stop) {
          const stopped = toStoppedResult(task, provider, stop, assertions, tests, trace);
          if (stopped.estimatedCostUsd !== undefined) suiteCostUsd += stopped.estimatedCostUsd;
          results.push(stopped);
        }
      } catch (error) {
        const failed = toFailedResult(task, provider, error, trace);
        if (failed.estimatedCostUsd !== undefined) suiteCostUsd += failed.estimatedCostUsd;
        results.push(failed);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    const suite = options.suite;
    const maxSteps = this.baseConfig.maxSteps;
    return suite ? results.map((result) => ({ suite, maxSteps, ...result })) : results;
  }
}

function emptyUsage(): Pick<EvaluationResult, 'durationMs' | 'steps' | 'toolCalls' | 'failedToolCalls' | 'recoveredFailures' | 'reductions' | 'inputTokens' | 'outputTokens' | 'totalTokens'> {
  return { durationMs: 0, steps: 0, toolCalls: 0, failedToolCalls: 0, recoveredFailures: 0, reductions: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function categoryOf(task: BenchmarkTask): Pick<EvaluationResult, 'category'> {
  return task.category ? { category: task.category } : {};
}

export function toSkippedResult(task: BenchmarkTask, provider: LlmProvider): EvaluationResult {
  return {
    taskId: task.id,
    ...categoryOf(task),
    provider: provider.name,
    model: 'not-started',
    passed: false,
    valid: false,
    stopReason: 'suite-budget-skip',
    ...emptyUsage(),
    assertionDetails: [],
    testsExecuted: false,
    agentRanTests: false,
    toolTrace: [],
    error: 'Task skipped because the live suite budget was reached.',
  };
}

export function toResult(
  task: BenchmarkTask,
  run: AgentRunResult,
  assertions: { passed: boolean; details: string[] },
  tests: GraderTestResult,
  costUsd: number | undefined,
  trace: string[],
): EvaluationResult {
  // A task passes only if the file assertions pass and, when the grader ran the tests, they pass too.
  const passed = assertions.passed && (!tests.testsExecuted || tests.testsPassed === true);
  return {
    taskId: task.id,
    ...categoryOf(task),
    provider: run.provider,
    model: run.model,
    passed,
    valid: true,
    stopReason: 'completed',
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
    assertionDetails: [...assertions.details, ...tests.details],
    assertionsPassed: assertions.passed,
    testsExecuted: tests.testsExecuted,
    ...(tests.testsPassed !== undefined ? { testsPassed: tests.testsPassed } : {}),
    agentRanTests: agentRanTests(trace),
    toolTrace: trace,
  };
}

/**
 * A run the agent loop stopped (step limit, repeated failure, task budget). It
 * is graded like a finished run and is valid: the agent failed, not the
 * infrastructure. The counters come from the error details.
 */
export function toStoppedResult(
  task: BenchmarkTask,
  provider: LlmProvider,
  stop: AgentStop,
  assertions: { passed: boolean; details: string[] },
  tests: GraderTestResult,
  trace: string[],
): EvaluationResult {
  const passed = assertions.passed && (!tests.testsExecuted || tests.testsPassed === true);
  return {
    ...usageFromDetails(task, provider, stop.details),
    passed,
    valid: true,
    stopReason: stop.reason,
    assertionDetails: [`run stopped: ${stop.message}`, ...assertions.details, ...tests.details],
    assertionsPassed: assertions.passed,
    testsExecuted: tests.testsExecuted,
    ...(tests.testsPassed !== undefined ? { testsPassed: tests.testsPassed } : {}),
    agentRanTests: agentRanTests(trace),
    toolTrace: trace,
    error: stop.message,
  };
}

/** Builds a result from a provider or infrastructure failure; the loop puts its counters in `error.details`. */
export function toFailedResult(task: BenchmarkTask, provider: LlmProvider, error: unknown, trace: string[]): EvaluationResult {
  return {
    ...usageFromDetails(task, provider, errorDetails(error)),
    passed: false,
    valid: false,
    stopReason: 'error',
    assertionDetails: [],
    testsExecuted: false,
    agentRanTests: agentRanTests(trace),
    toolTrace: trace,
    error: error instanceof Error ? error.message : String(error),
  };
}

function errorDetails(error: unknown): Record<string, unknown> {
  return error instanceof Error && 'details' in error && error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {};
}

function usageFromDetails(task: BenchmarkTask, provider: LlmProvider, details: Record<string, unknown>) {
  return {
    taskId: task.id,
    ...categoryOf(task),
    provider: typeof details.provider === 'string' ? details.provider : provider.name,
    model: typeof details.model === 'string' ? details.model : 'unknown',
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
  };
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
