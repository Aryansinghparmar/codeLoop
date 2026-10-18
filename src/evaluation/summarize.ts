import { median } from './metrics';
import { report, type EvaluationReport } from './report-generator';
import { agentAttemptedTests, agentRanTests, countRejectedShellCalls } from './trace-analysis';
import type { EvalSuite, EvaluationResult } from './types';

/**
 * How the pooled latency numbers are computed. `median()` returns the midpoint
 * of the two middle values when n is even; `percentile()` is nearest-rank, so
 * with n = 30 the P95 is the 29th sorted value.
 */
export const STAT_METHOD = 'pooled-across-runs, nearest-rank P95, midpoint median';

export interface RunInput {
  label: string;
  results: EvaluationResult[];
}

export type MatrixCell = 'pass' | 'fail' | 'invalid' | 'missing';

export interface TraceStats {
  runs: number;
  runsThatAttemptedTests: number;
  runsThatExecutedTests: number;
  toolCalls: number;
  failedToolCalls: number;
  autoRejectedShellCalls: number;
  compactionReductions: number;
  runsWithCompaction: number;
}

export interface GraderStats {
  /** Rows where the grader itself ran the task's tests (absent in older data). */
  rowsWithGraderTestRun: number;
  testsPassed: number;
  /** Rows that record the file-assertion result separately. */
  rowsWithAssertionResult: number;
  assertionsPassed: number;
}

/** One task across all repeats. Invalid and missing runs count as failures. */
export interface TaskRow {
  taskId: string;
  runs: number;
  passes: number;
  passRate: number;
  invalid: number;
  runsWithCompaction: number;
  medianSteps: number;
  meanCostUsd: number;
}

/**
 * pass@1: each task's pass rate over the k repeats, averaged over tasks.
 * pass@k: share of tasks that passed in at least one of the k repeats.
 * pass^k: share of tasks that passed in all k repeats.
 */
export interface PassAtK {
  k: number;
  tasks: number;
  pass1: number;
  passAtK: number;
  passHatK: number;
  method: string;
}

/** Whether runs whose context was compacted (reductions > 0) pass as often as the others. */
export interface CompactionStats {
  runsWithCompaction: number;
  passedWithCompaction: number;
  /** null when no run was compacted. */
  passRateWithCompaction: number | null;
  runsWithoutCompaction: number;
  passedWithoutCompaction: number;
  passRateWithoutCompaction: number | null;
}

export interface EvaluationSummary {
  statMethod: string;
  /** Suites found in the rows; rows written before v2 existed have no suite and are v1. */
  suites: string[];
  pooled: EvaluationReport & { latencyMinMs: number; latencyMaxMs: number; p95Rank: string };
  perRun: Array<{ label: string; report: EvaluationReport }>;
  passMatrix: { columns: string[]; rows: Record<string, MatrixCell[]> };
  traceStats: TraceStats;
  grader: GraderStats;
  totalEstimatedCostUsd: number;
  passRate: { passed: number; total: number; lowerBound95: number; method: string };
  passAtK: PassAtK;
  perTask: TaskRow[];
  compaction: CompactionStats;
}

export function summarize(runs: RunInput[]): EvaluationSummary {
  const all = runs.flatMap((run) => run.results);
  const pooled = report(all);
  const latencies = all.filter((result) => result.valid).map((result) => result.durationMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(0.95 * latencies.length) - 1);
  const passed = all.filter((result) => result.valid && result.passed).length;
  const matrix = passMatrix(runs);
  return {
    statMethod: STAT_METHOD,
    suites: [...new Set(all.map((result) => result.suite ?? 'v1'))],
    pooled: {
      ...pooled,
      latencyMinMs: latencies[0] ?? 0,
      latencyMaxMs: latencies.at(-1) ?? 0,
      p95Rank: latencies.length ? `${p95Index + 1}/${latencies.length}` : '0/0',
    },
    perRun: runs.map((run) => ({ label: run.label, report: report(run.results) })),
    passMatrix: matrix,
    traceStats: traceStats(all),
    grader: graderStats(all),
    totalEstimatedCostUsd: all.reduce((total, result) => total + (result.estimatedCostUsd ?? 0), 0),
    passRate: {
      passed,
      total: all.length,
      lowerBound95: clopperPearsonLower(passed, all.length),
      method: 'one-sided 95% Clopper-Pearson, assuming independent runs; repeats of the same task are correlated, so this is optimistic',
    },
    passAtK: passAtK(matrix),
    perTask: perTask(matrix, all),
    compaction: compactionStats(all),
  };
}

export function passAtK(matrix: { columns: string[]; rows: Record<string, MatrixCell[]> }): PassAtK {
  const k = matrix.columns.length;
  const passCounts = Object.values(matrix.rows).map((cells) => cells.filter((cell) => cell === 'pass').length);
  const share = (count: number): number => (passCounts.length ? count / passCounts.length : 0);
  return {
    k,
    tasks: passCounts.length,
    pass1: share(sum(passCounts.map((passes) => (k ? passes / k : 0)))),
    passAtK: share(passCounts.filter((passes) => passes > 0).length),
    passHatK: share(passCounts.filter((passes) => k > 0 && passes === k).length),
    method: 'k = number of runs (repeats); a task missing from a run, or invalid in it, counts as a failure there. With n = k samples per task, pass@k is the share of tasks with at least one pass.',
  };
}

export function perTask(matrix: { columns: string[]; rows: Record<string, MatrixCell[]> }, results: EvaluationResult[]): TaskRow[] {
  return Object.entries(matrix.rows).map(([taskId, cells]) => {
    const rows = results.filter((result) => result.taskId === taskId);
    const passes = cells.filter((cell) => cell === 'pass').length;
    return {
      taskId,
      runs: cells.length,
      passes,
      passRate: cells.length ? passes / cells.length : 0,
      invalid: cells.filter((cell) => cell === 'invalid').length,
      runsWithCompaction: rows.filter((result) => result.reductions > 0).length,
      medianSteps: median(rows.filter((result) => result.valid).map((result) => result.steps)),
      meanCostUsd: rows.length ? sum(rows.map((result) => result.estimatedCostUsd ?? 0)) / rows.length : 0,
    };
  });
}

export function compactionStats(results: EvaluationResult[]): CompactionStats {
  const passed = (rows: EvaluationResult[]): number => rows.filter((result) => result.valid && result.passed).length;
  const compacted = results.filter((result) => result.reductions > 0);
  const others = results.filter((result) => result.reductions === 0);
  return {
    runsWithCompaction: compacted.length,
    passedWithCompaction: passed(compacted),
    passRateWithCompaction: compacted.length ? passed(compacted) / compacted.length : null,
    runsWithoutCompaction: others.length,
    passedWithoutCompaction: passed(others),
    passRateWithoutCompaction: others.length ? passed(others) / others.length : null,
  };
}

/**
 * The summary file `eval:repeat` writes next to its JSONL files. It keeps the
 * old `reports`/`aggregate` keys and records how the numbers were computed,
 * so nobody has to patch it by hand afterwards.
 */
export function buildRepeatedSummary(input: { provider: string; model: string; suite: EvalSuite; startedAt: string; taskCount: number; resultFiles: string[]; runs: RunInput[] }) {
  const summary = summarize(input.runs);
  return {
    provider: input.provider,
    model: input.model,
    suite: input.suite,
    reportedModels: [...new Set(input.runs.flatMap((run) => run.results.map((result) => result.model)))],
    startedAt: input.startedAt,
    repeatCount: input.runs.length,
    taskCount: input.taskCount,
    statMethod: summary.statMethod,
    grading: 'passed = file assertions AND the grader\'s own bun test run (see grader / testsPassed)',
    reports: summary.perRun.map((run) => run.report),
    aggregate: { ...summary.pooled, statMethod: summary.statMethod },
    passMatrix: summary.passMatrix,
    traceStats: summary.traceStats,
    grader: summary.grader,
    totalEstimatedCostUsd: summary.totalEstimatedCostUsd,
    passRate: summary.passRate,
    passAtK: summary.passAtK,
    perTask: summary.perTask,
    compaction: summary.compaction,
    resultFiles: input.resultFiles,
  };
}

export function passMatrix(runs: RunInput[]): { columns: string[]; rows: Record<string, MatrixCell[]> } {
  const taskIds = [...new Set(runs.flatMap((run) => run.results.map((result) => result.taskId)))];
  const rows: Record<string, MatrixCell[]> = {};
  for (const taskId of taskIds) {
    rows[taskId] = runs.map((run) => {
      const result = run.results.find((item) => item.taskId === taskId);
      if (!result) return 'missing';
      if (!result.valid) return 'invalid';
      return result.passed ? 'pass' : 'fail';
    });
  }
  return { columns: runs.map((run) => run.label), rows };
}

export function traceStats(results: EvaluationResult[]): TraceStats {
  return {
    runs: results.length,
    runsThatAttemptedTests: results.filter((result) => agentAttemptedTests(result.toolTrace)).length,
    runsThatExecutedTests: results.filter((result) => agentRanTests(result.toolTrace)).length,
    toolCalls: sum(results.map((result) => result.toolCalls)),
    failedToolCalls: sum(results.map((result) => result.failedToolCalls)),
    autoRejectedShellCalls: sum(results.map((result) => countRejectedShellCalls(result.toolTrace))),
    compactionReductions: sum(results.map((result) => result.reductions)),
    runsWithCompaction: results.filter((result) => result.reductions > 0).length,
  };
}

function graderStats(results: EvaluationResult[]): GraderStats {
  const graded = results.filter((result) => result.testsExecuted === true);
  const withAssertions = results.filter((result) => result.assertionsPassed !== undefined);
  return {
    rowsWithGraderTestRun: graded.length,
    testsPassed: graded.filter((result) => result.testsPassed === true).length,
    rowsWithAssertionResult: withAssertions.length,
    assertionsPassed: withAssertions.filter((result) => result.assertionsPassed === true).length,
  };
}

/**
 * Exact one-sided lower confidence bound for a binomial proportion: the p at
 * which seeing `k` or more successes in `n` trials has probability `alpha`.
 * For k = n this is alpha^(1/n); otherwise it is found by bisection, because
 * P(X >= k) grows monotonically with p.
 */
export function clopperPearsonLower(k: number, n: number, alpha = 0.05): number {
  if (n <= 0 || k <= 0) return 0;
  if (k >= n) return alpha ** (1 / n);
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    if (binomialUpperTail(k, n, middle) < alpha) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialUpperTail(k: number, n: number, p: number): number {
  let total = 0;
  for (let i = k; i <= n; i += 1) total += binomial(n, i) * p ** i * (1 - p) ** (n - i);
  return total;
}

function binomial(n: number, k: number): number {
  let value = 1;
  for (let i = 1; i <= k; i += 1) value = (value * (n - k + i)) / i;
  return value;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function formatSummary(summary: EvaluationSummary): string {
  const { pooled, traceStats: trace, grader, passRate } = summary;
  const lines = [
    `statMethod: ${summary.statMethod}`,
    '',
    'Pooled report',
    `  runs ${pooled.taskCount}, valid ${pooled.validCount}, passed ${pooled.passedCount} (successRate ${pooled.successRate})`,
    `  medianLatencyMs ${pooled.medianLatencyMs}, p95LatencyMs ${pooled.p95LatencyMs} (rank ${pooled.p95Rank}), min ${pooled.latencyMinMs}, max ${pooled.latencyMaxMs}`,
    `  medianSteps ${pooled.medianSteps}, totalTokens ${pooled.totalTokens}`,
    '',
    'Per-run reports',
    ...summary.perRun.map(({ label, report: item }) => `  ${label}: passed ${item.passedCount}/${item.taskCount}, median ${item.medianLatencyMs} ms, p95 ${item.p95LatencyMs} ms, medianSteps ${item.medianSteps}, tokens ${item.totalTokens}`),
    '',
    `Pass matrix (columns: ${summary.passMatrix.columns.join(', ')})`,
    ...Object.entries(summary.passMatrix.rows).map(([taskId, cells]) => `  ${taskId.padEnd(4)} ${cells.join(' ')}`),
    '',
    'Trace stats',
    `  runs where the agent attempted a test command: ${trace.runsThatAttemptedTests}/${trace.runs}`,
    `  runs where the agent's test command ran and exited 0: ${trace.runsThatExecutedTests}/${trace.runs}`,
    `  failed tool calls: ${trace.failedToolCalls}/${trace.toolCalls}`,
    `  shell calls auto-rejected by the eval approval callback: ${trace.autoRejectedShellCalls}`,
    `  compaction reductions: ${trace.compactionReductions} (in ${trace.runsWithCompaction} runs)`,
    '',
    'Grader',
    grader.rowsWithGraderTestRun
      ? `  grader ran the task tests in ${grader.rowsWithGraderTestRun} rows; tests passed in ${grader.testsPassed}`
      : '  grader did not run tests in any row: "passed" here means the file assertions only',
    ...(grader.rowsWithAssertionResult ? [`  file assertions passed in ${grader.assertionsPassed}/${grader.rowsWithAssertionResult} rows`] : []),
    '',
    `Total estimated cost: $${summary.totalEstimatedCostUsd.toFixed(7)} (from the local price table, not a bill)`,
    `Pass rate ${passRate.passed}/${passRate.total}; 95% lower bound ${passRate.lowerBound95.toFixed(4)}`,
    `  (${passRate.method})`,
    '',
    `Suites: ${summary.suites.join(', ')}`,
    `pass@1 ${summary.passAtK.pass1.toFixed(4)}, pass@${summary.passAtK.k} ${summary.passAtK.passAtK.toFixed(4)}, pass^${summary.passAtK.k} ${summary.passAtK.passHatK.toFixed(4)} over ${summary.passAtK.tasks} tasks`,
    `  (${summary.passAtK.method})`,
    '',
    'Per task (passes/runs, invalid runs, runs with compaction, median steps, mean cost)',
    ...summary.perTask.map((row) => `  ${row.taskId.padEnd(4)} ${row.passes}/${row.runs}  invalid ${row.invalid}  compacted ${row.runsWithCompaction}  steps ${row.medianSteps}  $${row.meanCostUsd.toFixed(5)}`),
    '',
    'Compaction',
    `  runs with reductions > 0: ${formatRate(summary.compaction.passedWithCompaction, summary.compaction.runsWithCompaction)}`,
    `  runs without compaction: ${formatRate(summary.compaction.passedWithoutCompaction, summary.compaction.runsWithoutCompaction)}`,
  ];
  return lines.join('\n');
}

function formatRate(passed: number, runs: number): string {
  return runs ? `${runs}, passed ${passed} (${(passed / runs).toFixed(4)})` : '0 (no pass rate)';
}
