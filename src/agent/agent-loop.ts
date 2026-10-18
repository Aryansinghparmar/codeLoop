import type { CodeLoopConfig } from '../config/config';
import { ContextManager } from '../context/context-manager';
import type { LlmMessage, LlmProvider, LlmResponse, LlmToolCall } from '../llm/provider';
import type { PermissionPolicy, ApprovalFn } from '../permissions/permission-policy';
import type { PathGuard } from '../permissions/path-guard';
import { CodeLoopError } from '../shared/errors';
import type { ToolRegistry } from '../tools/registry';
import type { ToolExecutionContext, ToolResult } from '../tools/tool';
import { createRunStats, recordResponse, statsDetails, type RunStats } from './run-stats';

export interface AgentCallbacks {
  onText?: (text: string) => void;
  onToolCall?: (call: LlmToolCall) => void;
  onToolResult?: (call: LlmToolCall, result: { ok: boolean; content: string }) => void;
  approve?: ApprovalFn;
}

export interface AgentRunResult {
  text: string;
  messages: LlmMessage[];
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  recoveredFailures: number;
  reductions: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  provider: string;
  model: string;
  durationMs: number;
  estimatedCostUsd?: number;
}

const SYSTEM_PROMPT = `You are CodeLoop, a safe terminal coding agent.
Work only inside the current project. Use read before edit. Use edit for existing files and write for new files. Use shell only when needed. Never expose secrets. Stop when the task is complete and report the evidence.`;

export class AgentLoop {
  private readonly contextManager: ContextManager;

  public constructor(
    private readonly config: CodeLoopConfig,
    private readonly provider: LlmProvider,
    private readonly tools: ToolRegistry,
    private readonly pathGuard: PathGuard,
    private readonly permissionPolicy: PermissionPolicy,
  ) {
    this.contextManager = new ContextManager(config.contextBudgetTokens);
  }

  /**
   * One task: compact -> call model -> stop if no tool calls -> execute tools -> check stops, repeated.
   * Stops: no tool calls (done), maxSteps, same tool failure repeated, USD budget, provider error, abort.
   */
  public async run(prompt: string, callbacks: AgentCallbacks = {}, signal?: AbortSignal, history: LlmMessage[] = []): Promise<AgentRunResult> {
    const messages: LlmMessage[] = history.length > 0
      ? [...history, { role: 'user', content: prompt }]
      : [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }];
    const stats = createRunStats(this.provider.name);
    const failures = new RepeatedFailureTracker(this.config.maxRepeatedFailures);

    while (stats.steps < this.config.maxSteps) {
      if (signal?.aborted) throw this.failure('TOOL_ERROR', 'The task was cancelled.', stats);
      stats.steps += 1;
      this.compact(messages, stats);

      const response = await this.callModel(messages, stats, signal);
      if (stats.estimatedCostUsd !== undefined && stats.estimatedCostUsd > this.config.liveTaskBudgetUsd) {
        throw this.failure('PROVIDER_ERROR', `The live task budget of $${this.config.liveTaskBudgetUsd.toFixed(2)} was reached.`, stats);
      }
      messages.push(assistantMessage(response));
      if (response.text) callbacks.onText?.(response.text);
      if (response.toolCalls.length === 0) return this.success(response.text, messages, stats);

      for (const call of response.toolCalls) {
        stats.toolCalls += 1;
        const result = await this.executeToolCall(call, callbacks, signal);
        messages.push({ role: 'tool', content: result.content, toolCallId: call.id, name: call.name });
        if (!result.ok) stats.failedToolCalls += 1;
        const verdict = failures.record(call, result);
        stats.recoveredFailures = failures.recoveredFailures;
        if (verdict === 'abort') {
          throw this.failure('TOOL_ERROR', `The same tool failure repeated ${failures.repeats} times.`, stats, { tool: call.name });
        }
      }
    }
    throw this.failure('STEP_LIMIT', `The agent stopped after ${this.config.maxSteps} steps.`, stats);
  }

  /** Shrinks the history in place when it is over the context budget (see ContextManager). */
  private compact(messages: LlmMessage[], stats: RunStats): void {
    const reduction = this.contextManager.reduce(messages);
    if (!reduction.reduced) return;
    stats.reductions += 1;
    messages.splice(0, messages.length, ...reduction.messages);
  }

  private async callModel(messages: LlmMessage[], stats: RunStats, signal?: AbortSignal): Promise<LlmResponse> {
    let response: LlmResponse;
    try {
      response = await this.provider.complete({
        messages,
        tools: this.tools.definitions(),
        maxOutputTokens: this.config.modelOutputTokens,
        reasoningEffort: 'low',
      }, signal);
    } catch (error) {
      throw this.failureFromError(error, stats);
    }
    recordResponse(stats, response);
    return response;
  }

  private async executeToolCall(call: LlmToolCall, callbacks: AgentCallbacks, signal?: AbortSignal): Promise<ToolResult> {
    callbacks.onToolCall?.(call);
    const context: ToolExecutionContext = {
      projectRoot: this.config.projectRoot,
      pathGuard: this.pathGuard,
      permissionPolicy: this.permissionPolicy,
    };
    if (callbacks.approve) context.approve = callbacks.approve;
    if (signal) context.signal = signal;
    const result = await this.tools.execute(call.name, call.arguments, context);
    callbacks.onToolResult?.(call, result);
    return result;
  }

  private success(text: string, messages: LlmMessage[], stats: RunStats): AgentRunResult {
    return {
      text,
      messages,
      steps: stats.steps,
      toolCalls: stats.toolCalls,
      failedToolCalls: stats.failedToolCalls,
      recoveredFailures: stats.recoveredFailures,
      reductions: stats.reductions,
      usage: stats.usage,
      ...(stats.estimatedCostUsd !== undefined ? { estimatedCostUsd: stats.estimatedCostUsd } : {}),
      ...stats.lastResponse,
      durationMs: Date.now() - stats.startedAt,
    };
  }

  private failure(code: ConstructorParameters<typeof CodeLoopError>[0], message: string, stats: RunStats, extraDetails: Record<string, unknown> = {}): CodeLoopError {
    return new CodeLoopError(code, message, { ...extraDetails, ...statsDetails(stats) });
  }

  private failureFromError(error: unknown, stats: RunStats): CodeLoopError {
    const code = error instanceof CodeLoopError ? error.code : 'PROVIDER_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof CodeLoopError ? error.details : {};
    return this.failure(code, message, stats, details);
  }
}

function assistantMessage(response: LlmResponse): LlmMessage {
  const message: LlmMessage = { role: 'assistant', content: response.text };
  if (response.toolCalls.length) message.toolCalls = response.toolCalls;
  return message;
}

/**
 * Stops the run when the same tool fails with the same output `maxRepeats` times in a row.
 * Also counts recovered failures: a failure followed by a success or by a different failure.
 */
export class RepeatedFailureTracker {
  private lastFailure = '';
  private repeatCount = 0;
  private recovered = 0;

  public constructor(private readonly maxRepeats: number) {}

  public get repeats(): number { return this.repeatCount; }
  public get recoveredFailures(): number { return this.recovered; }

  public record(call: LlmToolCall, result: ToolResult): 'abort' | 'continue' {
    if (result.ok) {
      if (this.lastFailure) this.recovered += 1;
      this.lastFailure = '';
      this.repeatCount = 0;
      return 'continue';
    }
    const failureKey = `${call.name}:${result.content}`;
    if (failureKey === this.lastFailure) {
      this.repeatCount += 1;
    } else {
      if (this.lastFailure) this.recovered += 1;
      this.lastFailure = failureKey;
      this.repeatCount = 1;
    }
    return this.repeatCount >= this.maxRepeats ? 'abort' : 'continue';
  }
}
