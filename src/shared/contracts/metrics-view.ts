/** The per-feature metrics report (Stage 5): what each run and task cost and how often the user had to step in. */
export interface ExecutionMetrics {
  executionId: string;
  status: string;
  reviewStatus: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  durationMs: number | null;
  filesChanged: number;
  additions: number;
  deletions: number;
  deniedActions: number;
  policyViolations: number;
  checksRun: number;
  checksPassed: boolean | null;
  revisionOf: string | null;
  autoAccepted: boolean;
}
export interface TaskMetrics {
  workItemId: string;
  displayKey: string;
  title: string;
  status: string;
  executions: ExecutionMetrics[];
  attempts: number;
  acceptedOnFirstAttempt: boolean;
  interventions: number;
}
export interface FeatureReport {
  featureId: string;
  generatedAt: string;
  tasks: TaskMetrics[];
  totals: {
    tasks: number;
    done: number;
    executions: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    deniedActions: number;
    policyViolations: number;
    acceptedOnFirstAttempt: number;
    acceptedWithoutHuman: number;
    interventions: number;
    pilotWaits: number;
  };
}
