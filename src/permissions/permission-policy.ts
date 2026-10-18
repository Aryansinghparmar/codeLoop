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
  ruleId?: string;
}

export type ApprovalFn = (request: PermissionRequest) => Promise<boolean>;

export interface PermissionRule {
  id: string;
  pattern: RegExp;
  decision: PermissionDecision;
  reason: string;
}

const DENY_REASON = 'The command matches a hard-deny safety rule.';
const CONFIRM_REASON = 'The command uses chaining, redirection, network access, or Git state changes.';
const ALLOW_REASON = 'The command is in the safe allow-list.';

export const SHELL_RULES: readonly PermissionRule[] = [
  { id: 'delete-or-wipe', decision: 'deny', reason: DENY_REASON, pattern: /\b(?:remove-item|ri|rm|del|erase|rd|rmdir|clear-content|format-volume|diskpart|cipher)\b/iu },
  { id: 'eval-or-elevate', decision: 'deny', reason: DENY_REASON, pattern: /\b(?:invoke-expression|iex|start-process|runas|sudo|doas|psexec)\b/iu },
  { id: 'system-config', decision: 'deny', reason: DENY_REASON, pattern: /\b(?:takeown|icacls|set-executionpolicy|reg(?:\.exe)?|sc(?:\.exe)?|schtasks(?:\.exe)?)\b/iu },
  { id: 'power-or-service', decision: 'deny', reason: DENY_REASON, pattern: /\b(?:shutdown|restart-computer|stop-computer|set-service|new-service)\b/iu },
  { id: 'file-write-cmdlet', decision: 'deny', reason: DENY_REASON, pattern: /\b(?:set-content|out-file|add-content|copy-item|move-item|rename-item|new-item)\b/iu },
  { id: 'encoded-command', decision: 'deny', reason: DENY_REASON, pattern: /-(?:encodedcommand|encodedarguments|executionpolicy\s+bypass)\b/iu },
  { id: 'download-and-run', decision: 'deny', reason: DENY_REASON, pattern: /\b(?:frombase64string|downloadstring|scriptblock::create)\b/iu },
  { id: 'secret-variable', decision: 'deny', reason: DENY_REASON, pattern: /\$env:(?:openai_api_key|nvidia_api_key|aws_secret_access_key|azure_client_secret)\b/iu },
  { id: 'path-escape', decision: 'deny', reason: DENY_REASON, pattern: /\.\.[\\/]|(?:^|[\s"'(])(?:[a-z]:[\\/]|\\\\)/iu },
  { id: 'chaining-or-redirection', decision: 'confirm', reason: CONFIRM_REASON, pattern: /[;\r\n]|&&|\|\||\||>>?|<|`|\$\(/u },
  { id: 'network-or-install', decision: 'confirm', reason: CONFIRM_REASON, pattern: /\b(?:curl|wget|invoke-webrequest|invoke-restmethod|git\s+(?:clone|pull|push)|ssh|scp|bun\s+(?:install|add)|npm\s+install|npx)\b/iu },
  { id: 'git-state-change', decision: 'confirm', reason: CONFIRM_REASON, pattern: /\bgit\s+(?:commit|checkout|switch|reset|clean|merge|rebase)\b/iu },
  { id: 'bun-test-or-check', decision: 'allow', reason: ALLOW_REASON, pattern: /^bun\s+(?:test|run\s+(?:lint|typecheck))(?:\s|$)/iu },
  { id: 'typecheck', decision: 'allow', reason: ALLOW_REASON, pattern: /^tsc\s+--noEmit(?:\s|$)/iu },
  { id: 'git-read-only', decision: 'allow', reason: ALLOW_REASON, pattern: /^git\s+(?:status|diff)(?:\s|$)/iu },
  { id: 'list-or-version', decision: 'allow', reason: ALLOW_REASON, pattern: /^(?:get-childitem|get-location|pwd|dir|ls|node\s+--version|bun\s+--version)(?:\s|$)/iu },
];

const TIER_ORDER: readonly PermissionDecision[] = ['deny', 'confirm', 'allow'];

export function classifyCommand(command: string): PermissionResult {
  for (const decision of TIER_ORDER) {
    const rule = SHELL_RULES.find((candidate) => candidate.decision === decision && candidate.pattern.test(command));
    if (rule) return { decision, reason: rule.reason, ruleId: rule.id };
  }
  return { decision: 'confirm', reason: 'The command is not in the safe allow-list.', ruleId: 'default-confirm' };
}

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
    if (!command) return { decision: 'deny', reason: 'The command is empty.', ruleId: 'empty-command' };
    return classifyCommand(command);
  }
}
