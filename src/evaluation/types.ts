export interface BenchmarkTask {
  id: string;
  name: string;
  prompt: string;
  setup(root: string): Promise<void>;
  assert(root: string): Promise<{ passed: boolean; details: string[] }>;
  live: boolean;
}

export interface EvaluationResult {
  taskId: string;
  provider: string;
  model: string;
  passed: boolean;
  valid: boolean;
  durationMs: number;
  steps: number;
  toolCalls: number;
  failedToolCalls: number;
  recoveredFailures: number;
  reductions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  assertionDetails: string[];
  /** Result of the file-state assertions alone (older rows only have `passed`, which meant this). */
  assertionsPassed?: boolean;
  /** True when the grader itself ran the task's tests after the agent finished. */
  testsExecuted?: boolean;
  /** Exit code 0 from the grader's own test run. */
  testsPassed?: boolean;
  /** True when the agent's own test command ran and exited 0 (read from the trace). */
  agentRanTests?: boolean;
  toolTrace?: string[];
  error?: string;
}
