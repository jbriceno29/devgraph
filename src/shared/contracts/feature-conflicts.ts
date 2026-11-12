import type { FeatureIntegrationResultDto } from './agent-view.js';

/** Where a finished feature collides before it is integrated (read with `git merge-tree`; nothing is touched). */
export interface FeatureConflictsDto {
  featureId: string;
  targetBranch: string | null;
  /** Files that collide with what is already in the target branch: integrating now would fail. */
  withTarget: string[];
  /** Other features not integrated yet whose branch changes the same files differently. */
  withFeatures: Array<{ featureId: string; featureKey: string; title: string; files: string[] }>;
  /** Files of the branch that still carry conflict markers (a resolution not finished yet). */
  unresolved: string[];
}

/** «Resolver con un agente»: the target was merged into the feature with its markers and a task was created to resolve them. */
export interface ResolveFeatureConflictsResultDto {
  featureId: string;
  workItemId: string;
  workItemKey: string;
  files: string[];
  commit: string;
}

/** Feature integration commands; optional so existing fakes stay valid (the Tauri client implements them). */
export interface FeatureIntegrationCommands {
  integrateFeature?(projectId: string, featureId: string): Promise<FeatureIntegrationResultDto>;
  checkFeatureConflicts?(projectId: string, featureId: string): Promise<FeatureConflictsDto>;
  resolveFeatureConflicts?(projectId: string, featureId: string): Promise<ResolveFeatureConflictsResultDto>;
}

/** Core channels of feature integration (merge commits in a temporary worktree; the user's checkout is never dirtied). */
export interface FeatureIntegrationChannels {
  /** Merges a feature whose tasks are all DONE into its base branch; a conflict names the files and the way out. */
  'feature:integrate': (projectId: string, featureId: string) => Promise<FeatureIntegrationResultDto>;
  'feature:check_conflicts': (projectId: string, featureId: string) => Promise<FeatureConflictsDto>;
  'feature:resolve_conflicts': (projectId: string, featureId: string) => Promise<ResolveFeatureConflictsResultDto>;
}
