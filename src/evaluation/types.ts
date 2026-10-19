/** What the runner tells a task's assert() about the run. */
export interface AssertContext {
  /** The run's tool trace (each line cut to a few hundred characters). */
  trace: string[];
  /** True when one of the task's secretCanaries appeared in any full, untruncated tool call or result. */
  secretLeaked?: boolean;
}

/**
 * v2 grading. The hidden test runs in a fresh directory that holds only `copy`
 * (paths from the task directory) plus a grader-owned bunfig.toml, and passes
 * only when bun's JUnit report lists exactly `testNames`, all passed.
 */
export interface IsolatedGrader {
  copy: string[];
  testNames: string[];
}

export interface BenchmarkTask {
  id: string;
  name: string;
  prompt: string;
  setup(root: string): Promise<void>;
  /** File-state checks after the agent finished. */
  assert(root: string, context: AssertContext): Promise<{ passed: boolean; details: string[] }>;
  live: boolean;
  /** The task's own test file, run by the grader with `bun test` after the agent finished. */
  testFile?: string;
  /** A grader-owned test written only after the agent finished, so the agent cannot see or edit it. */
  graderTest?: string;
  /** When set, the hidden test is graded in isolation from bun's JUnit report (v2 tasks). */
  isolatedGrader?: IsolatedGrader;
  /** Values that must never reach the model; the runner checks full tool calls and results for them. */
  secretCanaries?: string[];
  /** Task family, e.g. 'bugfix' or 'long-context' (v2 tasks only). */
  category?: string;
  /** Applies the intended fix to a freshly set-up tree; used offline to prove the task is solvable. */
  referenceSolution?(root: string): Promise<void>;
}

export type EvalSuite = 'v1' | 'v2';

/**
 * Why a run ended. 'step-limit', 'repeated-failure' and 'task-budget' are agent
 * stops: the work is still graded and the row is valid. 'error' (provider or
 * infrastructure failure) and 'suite-budget-skip' (never started) are invalid rows.
 */
export type StopReason = 'completed' | 'step-limit' | 'repeated-failure' | 'task-budget' | 'suite-budget-skip' | 'error';

export interface EvaluationResult {
  taskId: string;
  /** Which task suite the row came from (absent in rows written before v2 existed, which are all v1). */
  suite?: EvalSuite;
  /** Task family (v2 rows only). */
  category?: string;
  provider: string;
  model: string;
  passed: boolean;
  valid: boolean;
  /** Absent in rows written before stop reasons were recorded. */
  stopReason?: StopReason;
  /** The step limit the run had (absent in older rows). */
  maxSteps?: number;
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
  /** The grader's own test run passed. */
  testsPassed?: boolean;
  /** True when the agent's own test command ran and exited 0 (read from the trace). */
  agentRanTests?: boolean;
  toolTrace?: string[];
  error?: string;
}
