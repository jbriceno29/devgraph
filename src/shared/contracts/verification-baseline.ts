/** Plan REP, R2: the repository's checks run once on a copy of the base branch, before planning. */
export interface VerificationBaselineDto {
  /** NOT_RUN: never ran for this project. RUNNING: in progress. DONE: see `checks`. */
  status: 'NOT_RUN' | 'RUNNING' | 'DONE';
  /** The commands it runs (or ran). */
  commands: string[];
  ranAt: string | null;
  ref: string | null;
  checks: Array<{
    command: string;
    passed: boolean;
    timedOut?: boolean;
    durationMs?: number;
    tail: string;
    /** «npm test: pasan 48, fallan 3». */
    summary: string;
  }>;
  knownFailing: string[];
  /** Failing commands not accepted as known: the pilot waits for them. */
  blocking: string[];
  error: string | null;
}

export interface VerificationBaselineChannels {
  'baseline:get': (projectId: string) => Promise<VerificationBaselineDto>;
  /** Starts it in the background (RUNNING at once); `commands` defaults to the policy's checks. */
  'baseline:run': (projectId: string, commands?: string[]) => Promise<VerificationBaselineDto>;
  /** Marks failing commands as known (excluded from verification until fixed) or clears them with []. */
  'baseline:accept_known': (projectId: string, commands: string[]) => Promise<VerificationBaselineDto>;
}

/** Optional so existing fakes stay valid; the Tauri client implements them. */
export interface VerificationBaselineCommands {
  getVerificationBaseline?(projectId: string): Promise<VerificationBaselineDto>;
  runVerificationBaseline?(projectId: string, commands?: string[]): Promise<VerificationBaselineDto>;
  acceptKnownFailures?(projectId: string, commands: string[]): Promise<VerificationBaselineDto>;
}
