import type { PermissionRequest } from '../permissions/permission-policy';

// One relative path token: letters, digits, _ . - / \ only. Nothing that a
// shell treats specially (; & | ` $ ( ) < > quotes, spaces, newlines).
const PATH_TOKEN = /^[\w./\\-]+$/u;

/**
 * The approval callback the evaluation runner gives the agent. Agent-written
 * tests are arbitrary code, so `bun test` needs approval; evals approve
 * exactly `bun test` with optional relative test-file paths and reject
 * everything else (other commands, flags, absolute paths, `..`, chaining).
 */
export function isEvalApproved(request: PermissionRequest): boolean {
  if (request.action !== 'shell') return false;
  const tokens = request.target.trim().split(/ +/u);
  if (tokens[0] !== 'bun' || tokens[1] !== 'test') return false;
  return tokens.slice(2).every(isRelativeTestPath);
}

function isRelativeTestPath(token: string): boolean {
  if (!PATH_TOKEN.test(token)) return false;
  if (token.startsWith('-') || token.startsWith('/') || token.startsWith('\\')) return false;
  return !token.split(/[/\\]/u).includes('..');
}

export async function approveEvalRequest(request: PermissionRequest): Promise<boolean> {
  return isEvalApproved(request);
}
