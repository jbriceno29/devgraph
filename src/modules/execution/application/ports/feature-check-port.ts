import type { CheckSummary } from '../../domain/check-summary.js';

export interface FeatureCheckRun {
  passed: boolean;
  checks: CheckSummary[];
  /** A conflict, a failed install, or the tail of the failed check's output. */
  detail: string | null;
  baseCommit: string;
  featureCommit: string;
}

/** Plan C6: runs the integration checks on the merge of a feature into its base, in a throwaway worktree. */
export interface FeatureCheckRunnerPort {
  heads(repositoryRoot: string, targetBranch: string, branch: string): Promise<{ base: string; feature: string }>;
  run(input: {
    projectId: string;
    repositoryRoot: string;
    targetBranch: string;
    branch: string;
    commands: string[];
  }): Promise<FeatureCheckRun>;
}

/** The integration checks of a project for a feature branch (from its stack profile or the branch's package.json). */
export interface IntegrationCommandsPort {
  commands(projectId: string, branch: string): Promise<string[]>;
}
