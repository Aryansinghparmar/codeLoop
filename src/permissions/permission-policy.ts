import { CodeLoopError } from '../shared/errors';
import type { PathGuard } from './path-guard';

export type PermissionAction = 'read' | 'write' | 'edit' | 'shell';
export type PermissionDecision = 'allow' | 'confirm' | 'deny';

export interface PermissionRequest {
  action: PermissionAction;
  target: string;
  detail?: string;
}

export interface PermissionResult {
  decision: PermissionDecision;
  reason: string;
}

export type ApprovalFn = (request: PermissionRequest) => Promise<boolean>;

const HARD_DENY_COMMANDS = [
  /\b(?:remove-item|ri|rm|del|erase|rd|rmdir|clear-content|format-volume|diskpart|cipher)\b/iu,
  /\b(?:invoke-expression|iex|start-process|runas|sudo|doas|psexec)\b/iu,
  /\b(?:takeown|icacls|set-executionpolicy|reg(?:\.exe)?|sc(?:\.exe)?|schtasks(?:\.exe)?)\b/iu,
  /\b(?:shutdown|restart-computer|stop-computer|set-service|new-service)\b/iu,
  /\b(?:set-content|out-file|add-content|copy-item|move-item|rename-item|new-item)\b/iu,
  /-(?:encodedcommand|encodedarguments|executionpolicy\s+bypass)\b/iu,
  /\b(?:frombase64string|downloadstring|scriptblock::create)\b/iu,
  /\$env:(?:openai_api_key|nvidia_api_key|aws_secret_access_key|azure_client_secret)\b/iu,
  /\.\.[\\/]|(?:^|[\s"'(])(?:[a-z]:[\\/]|\\\\)/iu,
];

const CONFIRM_COMMANDS = [
  /[;\r\n]|&&|\|\||\||>>?|<|`|\$\(/u,
  /\b(?:curl|wget|invoke-webrequest|invoke-restmethod|git\s+(?:clone|pull|push)|ssh|scp|bun\s+(?:install|add)|npm\s+install|npx)\b/iu,
  /\bgit\s+(?:commit|checkout|switch|reset|clean|merge|rebase)\b/iu,
];

const SAFE_COMMANDS = [
  /^bun\s+(?:test|run\s+(?:lint|typecheck))(?:\s|$)/iu,
  /^tsc\s+--noEmit(?:\s|$)/iu,
  /^git\s+(?:status|diff)(?:\s|$)/iu,
  /^(?:get-childitem|get-location|pwd|dir|ls|node\s+--version|bun\s+--version)(?:\s|$)/iu,
];

export class PermissionPolicy {
  public constructor(private readonly pathGuard: PathGuard) {}

  public evaluate(request: PermissionRequest): PermissionResult {
    if (request.action !== 'shell') {
      try {
        const path = this.pathGuard.resolveInside(request.target);
        if (this.pathGuard.isHardDenied(path)) return { decision: 'deny', reason: 'The path is protected.' };
      } catch (error) {
        if (error instanceof CodeLoopError) return { decision: 'deny', reason: error.message };
        return { decision: 'deny', reason: 'The path could not be validated.' };
      }
      if (request.action === 'read') return { decision: 'allow', reason: 'Read is non-destructive inside the project.' };
      return { decision: 'allow', reason: 'The edit is inside the project and requires a verified operation.' };
    }

    const command = request.target.trim();
    if (!command) return { decision: 'deny', reason: 'The command is empty.' };
    if (HARD_DENY_COMMANDS.some((pattern) => pattern.test(command))) return { decision: 'deny', reason: 'The command matches a hard-deny safety rule.' };
    if (CONFIRM_COMMANDS.some((pattern) => pattern.test(command))) return { decision: 'confirm', reason: 'The command uses chaining, redirection, network access, or Git state changes.' };
    if (SAFE_COMMANDS.some((pattern) => pattern.test(command))) return { decision: 'allow', reason: 'The command is in the safe allow-list.' };
    return { decision: 'confirm', reason: 'The command is not in the safe allow-list.' };
  }
}
