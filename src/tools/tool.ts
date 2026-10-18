import type { LlmToolDefinition } from '../llm/provider';
import type { PermissionPolicy, PermissionRequest, ApprovalFn } from '../permissions/permission-policy';
import type { PathGuard } from '../permissions/path-guard';

export interface ToolExecutionContext {
  projectRoot: string;
  pathGuard: PathGuard;
  // Only evaluate() is needed, so tests can pass a small fake policy.
  permissionPolicy: Pick<PermissionPolicy, 'evaluate'>;
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

/**
 * Applies the permission tier for one tool call.
 * Returns a failed ToolResult when the call must stop, or undefined when the tool may continue.
 * Approval is fail-closed: a `confirm` decision without an approver, or without an explicit
 * `true` from the approver, is rejected.
 */
export async function authorize(context: ToolExecutionContext, request: PermissionRequest): Promise<ToolResult | undefined> {
  const permission = context.permissionPolicy.evaluate(request);
  if (permission.decision === 'allow') return undefined;
  const label = request.action.charAt(0).toUpperCase() + request.action.slice(1);
  if (permission.decision === 'deny') return { ok: false, content: `${label} denied: ${permission.reason}` };

  // decision === 'confirm'
  if (!context.approve) {
    return { ok: false, content: `${label} rejected: approval is required but no approver is available. ${permission.reason}` };
  }
  const approved = await context.approve({ ...request, detail: permission.reason });
  if (approved !== true) return { ok: false, content: `${label} rejected by the user.` };
  return undefined;
}
