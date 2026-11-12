import type { FeatureIntegrationStateDto } from '../../../../shared/contracts/agent-view.js';

/** Git operations to find and hand over the conflicts between a feature branch and its target. */
export interface FeatureConflictGitPort {
  /** Paths that would conflict if `theirs` were merged into `ours` (empty: it merges cleanly). */
  conflicts(repositoryRoot: string, ours: string, theirs: string): Promise<string[]>;
  /** Files changed by `branch` since `base` that still contain conflict markers. */
  filesWithMarkers(repositoryRoot: string, branch: string, base: string): Promise<string[]>;
  /** Merges `sourceRef` into `branch` and commits the conflict markers; fails if it merges cleanly. */
  mergeWithConflicts(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    branch: string;
    sourceRef: string;
    message: string;
  }): Promise<{ commit: string; conflicts: string[] }>;
}

export interface FeatureRef {
  id: string;
  displayKey: string;
  title: string;
}

/** What the conflict use cases read about the project's features (graph and integration branches). */
export interface FeatureCatalogPort {
  repositoryRoot(projectId: string): string | null;
  features(projectId: string): FeatureRef[];
  integration(projectId: string, featureId: string): FeatureIntegrationStateDto | null;
}

/** Creates a READY task under a feature (through a ChangeSet, like any change to the plan). */
export interface FeatureTaskPort {
  create(
    projectId: string,
    featureId: string,
    task: { title: string; summary: string; acceptanceCriteria: string[] },
  ): Promise<{ id: string; displayKey: string }>;
}
