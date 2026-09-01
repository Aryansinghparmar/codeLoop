import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CodeLoopConfig {
  projectRoot: string;
  sessionRoot: string;
  maxSteps: number;
  processTimeoutMs: number;
  providerTimeoutMs: number;
  contextBudgetTokens: number;
  modelOutputTokens: number;
  toolOutputMaxChars: number;
  fileReadMaxChars: number;
  shellOutputMaxChars: number;
  diffMaxChars: number;
  maxRepeatedFailures: number;
  liveTaskBudgetUsd: number;
  liveSuiteBudgetUsd: number;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createConfig(projectRoot = process.env.CODELOOP_PROJECT_ROOT ?? process.cwd()): CodeLoopConfig {
  const root = resolve(projectRoot);
  const sessionRoot = process.env.CODELOOP_SESSION_ROOT ?? join(homedir(), '.codeloop', 'sessions');
  return {
    projectRoot: root,
    sessionRoot,
    maxSteps: numberEnv('CODELOOP_MAX_STEPS', 24),
    processTimeoutMs: numberEnv('CODELOOP_PROCESS_TIMEOUT_MS', 120_000),
    providerTimeoutMs: numberEnv('CODELOOP_PROVIDER_TIMEOUT_MS', 90_000),
    contextBudgetTokens: 32_000,
    modelOutputTokens: 4_096,
    toolOutputMaxChars: 16_000,
    fileReadMaxChars: 24_000,
    shellOutputMaxChars: 16_000,
    diffMaxChars: 24_000,
    maxRepeatedFailures: 3,
    liveTaskBudgetUsd: 0.4,
    liveSuiteBudgetUsd: 1.25,
  };
}
