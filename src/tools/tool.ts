import type { LlmToolDefinition } from '../llm/provider';
import type { PermissionPolicy, ApprovalFn } from '../permissions/permission-policy';
import type { PathGuard } from '../permissions/path-guard';

export interface ToolExecutionContext {
  projectRoot: string;
  pathGuard: PathGuard;
  permissionPolicy: PermissionPolicy;
  approve?: ApprovalFn;
  signal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  truncated?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Tool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  readonly definition: LlmToolDefinition;
  execute(args: TArgs, context: ToolExecutionContext): Promise<ToolResult>;
}

export function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  return value;
}

export function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string') throw new Error(`Tool argument '${name}' must be text.`);
  return value;
}
