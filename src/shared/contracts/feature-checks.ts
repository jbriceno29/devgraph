/** Plan C6: the checks that run once on the merged result before a feature is integrated (for example `next build`). */
export interface FeatureChecksDto {
  featureId: string;
  /**
   * NONE: the project has no integration checks. NOT_RUN: they never ran for this feature. RUNNING: in progress.
   * PASSED / FAILED: result for the current feature and base branch. STALE: the feature or the base moved since.
   */
  status: 'NONE' | 'NOT_RUN' | 'RUNNING' | 'PASSED' | 'FAILED' | 'STALE';
  commands: string[];
  checks: Array<{ command: string; passed: boolean; timedOut?: boolean; durationMs?: number }>;
  /** Why it failed beyond a check (a conflict, a failed install) or the end of the log of the check that failed. */
  detail: string | null;
  checkedAt: string | null;
}

export interface FeatureChecksChannels {
  'feature:checks': (projectId: string, featureId: string) => Promise<FeatureChecksDto>;
  /** Starts the checks in the background and returns at once (RUNNING); poll `feature:checks` for the result. */
  'feature:run_checks': (projectId: string, featureId: string) => Promise<FeatureChecksDto>;
}

/** Optional so existing fakes stay valid; the Tauri client implements them. */
export interface FeatureChecksCommands {
  getFeatureChecks?(projectId: string, featureId: string): Promise<FeatureChecksDto>;
  runFeatureChecks?(projectId: string, featureId: string): Promise<FeatureChecksDto>;
}
