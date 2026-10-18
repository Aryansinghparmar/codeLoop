// Three-tier permission policy (allow / confirm / deny) for the agent's tools.
// This is a policy layer, not a sandbox: shell commands are classified by regex over the
// command string, and a determined model can evade regexes (aliases, quoting, interpreters).
// It is fail-closed (unknown commands need confirmation); real isolation needs an OS sandbox.
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
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

/** Matches a command name only as a whole word, not inside a longer word or a path like `tests/rm.test.ts`. */
function commandWord(names: string): RegExp {
  return new RegExp(`(?<![\\w.\\\\/-])(?:${names})(?:\\.exe)?(?![\\w.\\\\/-])`, 'iu');
}

const deny = (id: string, reason: string, pattern: RegExp): PermissionRule => ({ id, decision: 'deny', reason, pattern });
const confirm = (id: string, reason: string, pattern: RegExp): PermissionRule => ({ id, decision: 'confirm', reason, pattern });
const allow = (id: string, reason: string, pattern: RegExp): PermissionRule => ({ id, decision: 'allow', reason, pattern });

export const SHELL_RULES: readonly PermissionRule[] = [
  // Destructive or privileged commands.
  deny('delete-or-wipe', 'The command deletes or wipes data.', commandWord('remove-item|ri|rm|del|erase|rd|rmdir|clear-content|format|format-volume|diskpart|cipher|mkfs|shred')),
  deny('eval-or-elevate', 'The command evaluates code or elevates privileges.', commandWord('invoke-expression|iex|start-process|runas|sudo|doas|psexec')),
  deny('system-config', 'The command changes system configuration.', commandWord('takeown|icacls|set-executionpolicy|reg|sc|schtasks')),
  deny('power-or-service', 'The command changes power state or services.', commandWord('shutdown|restart-computer|stop-computer|set-service|new-service')),
  deny('file-write-cmdlet', 'The command writes files outside the write/edit tools.', commandWord('set-content|out-file|add-content|copy-item|move-item|rename-item|new-item')),
  deny('destructive-git', 'The command destroys Git history or untracked work.', /\bgit\s+(?:push\b[^;&|]*\s(?:--force(?:-with-lease)?|-f)\b|reset\b[^;&|]*\s--hard\b|clean\b[^;&|]*\s-\w*f)/iu),
  deny('encoded-command', 'The command hides its payload.', /-(?:encodedcommand|encodedarguments|executionpolicy\s+bypass)\b|\b(?:powershell|pwsh)(?:\.exe)?\b[^|;&]*\s-e(?:c|n\w*)?\b/iu),
  deny('download-and-run', 'The command downloads and runs code.', /\b(?:frombase64string|downloadstring|scriptblock::create)\b|\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|node|python3?|bun)\b/iu),
  // Secrets: environment dumps, protected files and the home directory.
  deny('environment-variable', 'The command reads environment variables, which hold API keys.', /\$\{?env:|\bgetenvironmentvariables?\b/iu),
  deny('environment-dump', 'The command dumps the environment, which holds API keys.', /(?<![\w$])env:|\bprintenv\b|(?:^|[;&|(]\s*)env(?=\s|$)|(?:^|[;&|(]\s*)(?:set|export)\s*(?=$|[;&|)])|\/proc\/[^\s/]+\/environ/iu),
  deny('protected-file-reference', 'The command references a protected file (secrets, keys or .git).', /(?<![\w.-])\.env(?!\.example(?![\w.-]))(?:\.[\w-]+)*(?![\w-])|(?<![\w.-])\.(?:git|ssh|aws|azure|kube|codeloop)(?![\w.-])|(?<![\w.-])(?:id_(?:rsa|ed25519|ecdsa|dsa)|known_hosts)(?![\w-])|(?<![\w.-])(?:credentials|secrets?|service-account|token)\.(?:json|ya?ml|toml)(?![\w.-])|\.(?:pem|key|pfx|p12)(?![\w.-])/iu),
  deny('home-directory', 'The command references the home directory, outside the project.', /(?:^|[\s"'=(,])~|\$\{?home\b/iu),
  deny('path-escape', 'The command references a path outside the project.', /\.\.[\\/]|(?:^|[\s"'(=])(?:[a-z]:[\\/]|\\\\)/iu),
  // Anything that runs project code, reaches the network, writes files or changes Git state.
  confirm('chaining-or-redirection', 'The command uses chaining, redirection or command substitution.', /[;\r\n]|&&|\|\||\||>>?|<|`|\$\(/u),
  confirm('call-or-background-operator', 'The command uses `&` (PowerShell call operator or background job).', /&/u),
  confirm('subexpression', 'The command uses a subexpression or script block, which runs code.', /[({]/u),
  confirm('runs-project-code', 'The command runs project code, which the agent can write.', commandWord('bun|bunx|npm|npx|pnpm|yarn|node|deno|tsx|ts-node|python|python3|py')),
  confirm('nested-shell', 'The command starts another shell.', commandWord('powershell|pwsh|cmd|sh|bash|zsh')),
  confirm('write-or-preload-flag', 'The command uses a flag that writes a file or preloads code.', /--(?:output|out-file|preload|require|import|ext-diff|textconv)(?![\w-])/iu),
  confirm('parent-directory', 'The command references the parent directory.', /(?<![\w.])\.\.(?![\w.])/u),
  confirm('absolute-path', 'The command uses an absolute path.', /(?:^|[\s"'=(,])[\\/]/u),
  confirm('list-unsafe-argument', 'The listing argument is not a plain relative path.', /^(?:ls|dir|gci|get-childitem)\s+(?![\w.][\w.\\/-]*$)/iu),
  confirm('network-or-install', 'The command uses the network or installs packages.', /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|ssh|scp|git\s+(?:clone|pull|push|fetch))\b/iu),
  confirm('git-state-change', 'The command changes Git state.', /\bgit\s+(?:commit|checkout|switch|reset|clean|merge|rebase|stash|restore|rm|mv|add)\b/iu),
  // Read-only commands that cannot run project code.
  allow('git-read-only', 'Read-only Git inspection.', /^git\s+(?:status|diff|log|show)(?:\s|$)/iu),
  allow('list-directory', 'Lists a directory inside the project.', /^(?:ls|dir|gci|get-childitem)(?:\s+[\w.][\w.\\/-]*)?$/iu),
  allow('print-location', 'Prints the current directory.', /^(?:pwd|get-location)$/iu),
  allow('echo-plain-text', 'Echoes plain text.', /^echo(?:\s+[\w\s.,:!?'"-]*)?$/iu),
  allow('typecheck', 'Type-checks without emitting or running code.', /^tsc\s+--noEmit$/iu),
];

const TIER_ORDER: readonly PermissionDecision[] = ['deny', 'confirm', 'allow'];

export function classifyCommand(command: string): PermissionResult {
  for (const decision of TIER_ORDER) {
    const rule = SHELL_RULES.find((candidate) => candidate.decision === decision && candidate.pattern.test(command));
    if (rule) return { decision, reason: rule.reason, ruleId: rule.id };
  }
  return { decision: 'confirm', reason: 'The command is not in the safe allow-list.', ruleId: 'default-confirm' };
}

// Files that change how `bun`, `tsc` or CI run code: editing them is as powerful as running a command.
const PROJECT_CONFIG = /^(?:.*\/)?(?:package\.json|bun\.lockb?|tsconfig[^/]*\.json|bunfig\.toml)$|^\.github\//iu;
const SOURCE_DIRECTORY = /^(?:src|tests)\//u;

export class PermissionPolicy {
  public constructor(private readonly pathGuard: PathGuard) {}

  public evaluate(request: PermissionRequest): PermissionResult {
    if (request.action === 'shell') {
      const command = request.target.trim();
      if (!command) return { decision: 'deny', reason: 'The command is empty.', ruleId: 'empty-command' };
      return classifyCommand(command);
    }
    return this.evaluateFile(request);
  }

  private evaluateFile(request: PermissionRequest): PermissionResult {
    let path: string;
    try {
      path = this.pathGuard.resolveInside(request.target);
    } catch (error) {
      const reason = error instanceof CodeLoopError ? error.message : 'The path could not be validated.';
      return { decision: 'deny', reason, ruleId: 'path-guard' };
    }
    if (request.action === 'read') return { decision: 'allow', reason: 'Read is non-destructive inside the project.', ruleId: 'read-inside-project' };
    const projectPath = relative(this.pathGuard.projectRoot, path).replaceAll('\\', '/');
    if (PROJECT_CONFIG.test(projectPath)) {
      return { decision: 'confirm', reason: 'The file configures how project code is built or run.', ruleId: 'project-config' };
    }
    if (!SOURCE_DIRECTORY.test(projectPath) && existsSync(path)) {
      return { decision: 'confirm', reason: 'The change overwrites an existing file outside src/ and tests/.', ruleId: 'overwrite-outside-source' };
    }
    return { decision: 'allow', reason: 'The change creates a file or edits one under src/ or tests/.', ruleId: 'new-or-source-file' };
  }
}
