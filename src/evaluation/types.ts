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
  toolTrace?: string[];
  error?: string;
}
