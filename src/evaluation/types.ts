export interface BenchmarkTask {
  id: string;
  name: string;
  prompt: string;
  setup(root: string): Promise<void>;
  /** File-state checks after the agent finished. `trace` is the run's tool trace. */
  assert(root: string, context: { trace: string[] }): Promise<{ passed: boolean; details: string[] }>;
  live: boolean;
  /** The task's own test file, run by the grader with `bun test` after the agent finished. */
  testFile?: string;
  /** A grader-owned test written only after the agent finished, so the agent cannot see or edit it. */
  graderTest?: string;
  /**
   * How many tests the hidden grader test contains. When set, the grader also
   * requires bun to report exactly this many passes and 0 failures, because an
   * exit code of 0 alone can be faked (a module that calls process.exit(0)).
   */
  graderTestCount?: number;
  /** Task family, e.g. 'bugfix' or 'long-context' (v2 tasks only). */
  category?: string;
  /** Applies the intended fix to a freshly set-up tree; used offline to prove the task is solvable. */
  referenceSolution?(root: string): Promise<void>;
}

export type EvalSuite = 'v1' | 'v2';

export interface EvaluationResult {
  taskId: string;
  /** Which task suite the row came from (absent in rows written before v2 existed, which are all v1). */
  suite?: EvalSuite;
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
