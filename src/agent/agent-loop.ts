import type { CodeLoopConfig } from '../config/config';
import { ContextManager } from '../context/context-manager';
import type { LlmMessage, LlmProvider, LlmToolCall } from '../llm/provider';
import type { PermissionPolicy, ApprovalFn } from '../permissions/permission-policy';
import type { PathGuard } from '../permissions/path-guard';
import { CodeLoopError, errorMessage } from '../shared/errors';
import type { ToolRegistry } from '../tools/registry';
import type { ToolExecutionContext } from '../tools/tool';
import { estimateProviderCost } from '../llm/pricing';

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

  public async run(prompt: string, callbacks: AgentCallbacks = {}, signal?: AbortSignal, history: LlmMessage[] = []): Promise<AgentRunResult> {
    const started = Date.now();
    const messages: LlmMessage[] = history.length > 0
      ? [...history, { role: 'user', content: prompt }]
      : [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }];
    let steps = 0;
    let toolCalls = 0;
    let failedToolCalls = 0;
    let recoveredFailures = 0;
    let reductions = 0;
    let lastFailure = '';
    let repeatedFailures = 0;
    let lastResponse = { provider: this.provider.name, model: 'unknown' };
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let estimatedCostUsd: number | undefined;

    while (steps < this.config.maxSteps) {
      if (signal?.aborted) throw this.failure('TOOL_ERROR', 'The task was cancelled.', started, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, lastResponse, estimatedCostUsd);
      steps += 1;
      const reduction = this.contextManager.reduce(messages);
      if (reduction.reduced) {
        reductions += 1;
        messages.splice(0, messages.length, ...reduction.messages);
      }
      let response;
      try {
        response = await this.provider.complete({
          messages,
          tools: this.tools.definitions(),
          maxOutputTokens: this.config.modelOutputTokens,
          reasoningEffort: 'low',
        }, signal);
      } catch (error) {
        throw this.failureFromError(error, started, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, lastResponse, estimatedCostUsd);
      }
      lastResponse = { provider: response.provider, model: response.model };
      usage.inputTokens += response.usage.inputTokens ?? 0;
      usage.outputTokens += response.usage.outputTokens ?? 0;
      usage.totalTokens += response.usage.totalTokens ?? ((response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0));
      estimatedCostUsd = estimateProviderCost(response.provider, response.model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens });
      if (estimatedCostUsd !== undefined && estimatedCostUsd > this.config.liveTaskBudgetUsd) {
        throw this.failure('PROVIDER_ERROR', `The live task budget of $${this.config.liveTaskBudgetUsd.toFixed(2)} was reached.`, started, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, lastResponse, estimatedCostUsd);
      }
      const assistantMessage: LlmMessage = { role: 'assistant', content: response.text };
      if (response.toolCalls.length) assistantMessage.toolCalls = response.toolCalls;
      messages.push(assistantMessage);
      if (response.text) callbacks.onText?.(response.text);
      if (response.toolCalls.length === 0) {
        return { text: response.text, messages, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}), ...lastResponse, durationMs: Date.now() - started };
      }

      for (const call of response.toolCalls) {
        toolCalls += 1;
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
        messages.push({ role: 'tool', content: result.content, toolCallId: call.id, name: call.name });
        if (!result.ok) {
          failedToolCalls += 1;
          const failureKey = `${call.name}:${result.content}`;
          if (failureKey === lastFailure) repeatedFailures += 1;
          else {
            if (lastFailure) recoveredFailures += 1;
            lastFailure = failureKey;
            repeatedFailures = 1;
          }
          if (repeatedFailures >= this.config.maxRepeatedFailures) {
            throw this.failure('TOOL_ERROR', `The same tool failure repeated ${repeatedFailures} times.`, started, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, lastResponse, estimatedCostUsd, { tool: call.name });
          }
        } else if (lastFailure) {
          recoveredFailures += 1;
          lastFailure = '';
          repeatedFailures = 0;
        }
      }
    }
    throw this.failure('STEP_LIMIT', `The agent stopped after ${this.config.maxSteps} steps.`, started, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, lastResponse, estimatedCostUsd);
  }

  private failure(
    code: ConstructorParameters<typeof CodeLoopError>[0],
    message: string,
    started: number,
    steps: number,
    toolCalls: number,
    failedToolCalls: number,
    recoveredFailures: number,
    reductions: number,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    lastResponse: { provider: string; model: string },
    estimatedCostUsd: number | undefined,
    details: Record<string, unknown> = {},
  ): CodeLoopError {
    return new CodeLoopError(code, message, {
      ...details,
      provider: lastResponse.provider,
      model: lastResponse.model,
      durationMs: Date.now() - started,
      steps,
      toolCalls,
      failedToolCalls,
      recoveredFailures,
      reductions,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    });
  }

  private failureFromError(
    error: unknown,
    started: number,
    steps: number,
    toolCalls: number,
    failedToolCalls: number,
    recoveredFailures: number,
    reductions: number,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    lastResponse: { provider: string; model: string },
    estimatedCostUsd: number | undefined,
  ): CodeLoopError {
    const code = error instanceof CodeLoopError ? error.code : 'PROVIDER_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof CodeLoopError ? error.details : {};
    return this.failure(code, message, started, steps, toolCalls, failedToolCalls, recoveredFailures, reductions, usage, lastResponse, estimatedCostUsd, details);
  }
}
