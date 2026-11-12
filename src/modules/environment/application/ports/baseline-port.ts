import type { VerificationBaseline } from '../../domain/verification-baseline.js';

export interface BaselineStorePort {
  get(projectId: string): VerificationBaseline | null;
  save(projectId: string, baseline: VerificationBaseline): void;
}

/** Runs the checks on a throwaway copy of `ref` with the project's environment installed (no branch moves). */
export interface BaselineRunnerPort {
  run(input: { projectId: string; commands: string[] }): Promise<{
    ref: string;
    commit: string;
    results: Array<{ command: string; exitCode: number; output: string; timedOut?: boolean; durationMs?: number }>;
    error?: string;
  }>;
}

/**
 * The project's verification (its policy): a failure accepted as known leaves it, and comes back once it is no longer
 * known (the user changed their mind, or the baseline passes again because the fix task made it pass).
 */
export interface PolicyChecksPort {
  exclude(projectId: string, commands: string[]): void;
  restore(projectId: string, commands: string[]): void;
}

/** The checks the baseline runs when none are given: the project's verification commands. */
export interface BaselineCommandsPort {
  defaults(projectId: string): string[];
  /** Spanish problems of commands the user typed (shell operators, installs); empty when valid. */
  issues(commands: string[]): string[];
}
