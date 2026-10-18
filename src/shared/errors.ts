export type ErrorCode =
  | 'CONFIG_ERROR'
  | 'PATH_DENIED'
  | 'PERMISSION_DENIED'
  | 'TOOL_ERROR'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'CONTEXT_LIMIT'
  | 'STEP_LIMIT'
  | 'SESSION_ERROR'
  | 'EVALUATION_ERROR';

export class CodeLoopError extends Error {
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown>;

  public constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CodeLoopError';
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
