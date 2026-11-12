import type { ProjectEnvironment } from '../../domain/projects/stack-catalog.js';
import type {
  AgentExecution,
  AgentEvent,
  AgentProfile,
  AgentProvider,
  ExecutionFileDiff,
} from '../../domain/agents/models.js';
import type { WorkItem } from '../../domain/work-management/entities.js';
import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
import type { AutonomyPolicy, ApprovalRequest } from '../../domain/governance/models.js';
import type { TaskOutcome } from '../../domain/work-management/task-outcome.js';

export interface AgentExecutionProfile extends AgentProfile {
  provider: AgentProvider;
  /** Model aliases the provider offers, and the default for this profile's role. */
  models: { default: string | null; planning: string | null; available: string[] };
  /** Opaque provider connection settings (e.g. authMode), handed to the adapter. */
  connectionConfig: Record<string, unknown>;
}

export interface AgentExecutionRepositoryPort {
  listProfiles(projectId: string): AgentExecutionProfile[];
  findProfile(projectId: string, profileId: string): AgentExecutionProfile | null;
  findWorkItem(projectId: string, workItemId: string): WorkItem | null;
  getRepositoryRoot(projectId: string): string | null;
  getRepositoryId(projectId: string): string | null;
  getAutonomyPolicy(projectId: string, profileId: string): AutonomyPolicy;
  updateAutonomyPolicy(
    policyId: string,
    fields: Pick<
      AutonomyPolicy,
      | 'writablePaths'
      | 'readonlyPaths'
      | 'deniedPaths'
      | 'allowedCommands'
      | 'maxExecutionMinutes'
      | 'maxTurns'
      | 'decisionPolicy'
    >,
  ): void;
  /** Closes approval requests left PENDING by an execution that will never resume. */
  rejectPendingApprovals(executionId: string, note: string): void;
  /** Sets `authMode` in the wired provider's connection config. */
  setProviderAuthMode(projectId: string, mode: 'subscription' | 'api_key'): void;
  createExecution(execution: AgentExecution): void;
  updateExecution(execution: AgentExecution): void;
  findExecution(executionId: string): AgentExecution | null;
  listExecutions(projectId: string): AgentExecution[];
  appendEvent(executionId: string, event: AgentEvent): { id: string; sequenceNo: number; createdAt: string };
  listEvents(executionId: string): Array<{ id: string; sequenceNo: number; createdAt: string; event: AgentEvent }>;
  createApprovalRequest(request: ApprovalRequest): void;
  resolveApprovalRequest(requestId: string, decision: { approved: boolean; resolvedBy: string; note: string }): void;
  /** Moves a work item through the WorkItem state machine; bumps and returns the graph revision. */
  transitionWorkItem(
    projectId: string,
    workItemId: string,
    to: import('../../domain/work-management/entities.js').WorkItemStatus,
  ): number;
  /** Work items this one DEPENDS_ON (direct edges only). */
  listDependencies(
    projectId: string,
    workItemId: string,
  ): Array<{ id: string; displayKey: string; title: string; status: string }>;
  /** Work items that DEPEND_ON this one. */
  listDependents(
    projectId: string,
    workItemId: string,
  ): Array<{ id: string; displayKey: string; title: string; status: string }>;
  /** Nearest FEATURE ancestor of a work item (following parent links), or null. */
  findFeatureFor(projectId: string, workItemId: string): { id: string; displayKey: string; title: string } | null;
  /** Features this one depends on: DEPENDS_ON between FEATUREs, plus the features of tasks its tasks depend on. */
  listFeatureDependencies(
    projectId: string,
    featureId: string,
  ): Array<{ id: string; displayKey: string; title: string }>;
  /** Work items under a feature (subtasks included), ordered by key. */
  listFeatureTasks(
    projectId: string,
    featureId: string,
  ): Array<{ id: string; displayKey: string; title: string; status: string }>;
  /** Integration branch owned by a feature (or by a work item without a feature). */
  getIntegrationBranch(
    ownerId: string,
  ): { branchName: string; sourceBranch: string; integratedAt?: string | null } | null;
  saveIntegrationBranch(input: {
    ownerId: string;
    projectId: string;
    repositoryId: string;
    branchName: string;
    sourceBranch: string;
  }): void;
  /** Records when a feature branch was integrated into its base branch (null: it has new work since). Optional for fakes. */
  setFeatureIntegrated?(projectId: string, branchName: string, at: string | null): void;
  /** Repository paths of the project's Markdown documents (artifacts and decision records). */
  listDocumentPaths(projectId: string): string[];
  /**
   * Stores the outcome of an accepted task and its evidence in the graph: a CODE_REFERENCE per changed file with a
   * MODIFIES edge (GENERATED_BY for the project's documents), provenance EXECUTION. Bumps and returns the graph revision.
   */
  recordTaskOutcome(outcome: TaskOutcome, repositoryId: string): number;
  findTaskOutcome(workItemId: string): TaskOutcome | null;
  /** Engine-side id of an agent session (what `--resume` takes). */
  externalSessionId(sessionId: string): string | null;
  listFileDiffs(
    executionId: string,
  ): Array<{ filePath: string; changeType: string; additions: number; deletions: number; diffPatch: string | null }>;
  recordFileDiffs(
    executionId: string,
    repositoryId: string,
    diffs: Array<Pick<ExecutionFileDiff, 'filePath' | 'changeType' | 'additions' | 'deletions' | 'diffPatch'>>,
  ): void;
}

export interface GitIsolationPort {
  prepare(input: {
    projectId: string;
    executionId: string;
    workItemKey: string;
    repositoryRoot: string;
    workspaceRoot: string;
    requireWorktree: boolean;
    startPoint?: string;
  }): Promise<{ workingDirectory: string; branchName: string; baseCommit: string; baseBranch: string | null }>;
  /** Removes a worktree and branch created by `prepare` that never received agent work. */
  discard(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    workingDirectory: string;
    branchName: string;
  }): Promise<void>;
  currentBranch(repositoryRoot: string): Promise<string | null>;
  branchExists(repositoryRoot: string, branchName: string): Promise<boolean>;
  createIntegrationBranch(input: { repositoryRoot: string; preferredName: string; sourceRef: string }): Promise<string>;
  mergeInto(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    targetBranch: string;
    sourceRef: string;
    message: string;
  }): Promise<
    | { ok: true; commit: string; changed: boolean }
    | { ok: false; reason: 'CONFLICT' | 'CHECKED_OUT'; detail: string; conflicts: string[] }
  >;
  uncommittedPaths(repositoryRoot: string, paths: string[]): Promise<string[]>;
  commitFiles(
    repositoryRoot: string,
    commit: string,
  ): Promise<Array<{ path: string; status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' }>>;
  pathsDiffer(repositoryRoot: string, leftRef: string, rightRef: string, paths: string[]): Promise<string[]>;
  /** Whether `ancestor` is already contained in `descendant`. */
  isAncestor(repositoryRoot: string, ancestor: string, descendant: string): Promise<boolean>;
  /** Deletes an integration branch Graph Workspace just created (used to roll back a failed creation). */
  deleteIntegrationBranch(repositoryRoot: string, branchName: string): Promise<void>;
  /**
   * Merges `sourceRef` into `targetBranch` with a merge commit, built in a throwaway worktree. When the target is checked
   * out in the user's repository it must be clean and is fast-forwarded there; checked out elsewhere, it is refused.
   */
  mergeIntoBase(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    targetBranch: string;
    sourceRef: string;
    message: string;
  }): Promise<
    | { ok: true; commit: string; changed: boolean }
    | { ok: false; reason: 'CONFLICT' | 'CHECKED_OUT' | 'DIRTY'; detail: string; conflicts: string[] }
  >;
  squashMerge(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    targetBranch: string;
    sourceRef: string;
    message: string;
  }): Promise<
    | { ok: true; commit: string; changed: boolean }
    | { ok: false; reason: 'CONFLICT' | 'CHECKED_OUT'; detail: string; conflicts: string[] }
  >;
}
/** Plan S2: the dependencies the app (never the agent) installs in a run's worktree. */
export type EnvironmentReconcileResult =
  | { ok: true; log: string }
  | { ok: false; reason: 'DEPENDENCY_APPROVAL' | 'ENVIRONMENT'; unapproved: string[]; log: string };
export interface WorkspaceEnvironmentPort {
  /** null when the project's stack installs nothing. */
  forProject(projectId: string): ProjectEnvironment | null;
  /** Before the agent runs: completes the manifest with the profile's packages and installs; commits the manifest when it changed (returns that commit). */
  provision(input: {
    projectId: string;
    executionId: string;
    workingDirectory: string;
    projectName: string;
    environment: ProjectEnvironment;
  }): Promise<{
    log: string;
    commit: string | null /** false when there was nothing to install (no manifest or no dependencies). */;
    installed?: boolean;
  }>;
  /** After the agent ran, before the checks: refuses packages outside the allowed list and reinstalls when the manifest changed. */
  reconcile(input: {
    workingDirectory: string;
    baseManifest: string | null;
    environment: ProjectEnvironment;
  }): Promise<EnvironmentReconcileResult>;
}
/** Plan S4: skills that ship with the app, copied into the worktree of the runs that need them. */
export interface SkillProvisionPort {
  /** Ids of the bundled skills this run should carry (empty for most runs). */
  select(input: { projectId: string; tasks: Array<{ id: string; title: string; summary: string }> }): Promise<string[]>;
  /** Copies them into the worktree; returns the paths the app owns there and one prompt note per skill. */
  materialize(input: { workingDirectory: string; skillIds: string[] }): Promise<{ paths: string[]; notes: string[] }>;
  /** Where any bundled skill would live in a worktree: never the agent's work, never committed. */
  ownedPaths(): Promise<string[]>;
}
export interface ExecutionValidatorPort {
  validate(input: {
    projectId: string;
    executionId: string;
    workingDirectory: string;
    repositoryRoot: string;
    repositoryId: string;
    initialCommit: string;
    policy: AutonomyPolicy;
    commitMessage?: string;
    environment?: ProjectEnvironment /** Paths the app wrote into the worktree besides the environment (bundled skills). */;
    ownedPaths?: string[];
  }): Promise<{ passed: boolean; finalCommit: string | null; resultSummary: string; testSummary: unknown | null }>;
}

export interface AgentContextBuilderPort {
  build(input: {
    projectId: string;
    focusEntityId: string /** Other tasks of a grouped run (anchors like the focus). */;
    extraFocusEntityIds?: string[];
    repositoryRoot: string;
    executionId: string /** Commit the run starts from: the context is read from it. */;
    sourceCommit: string;
  }): Promise<{ snapshot: ContextSnapshot; packageText: string }>;
}

export interface ExecutionEventLogPort {
  append(
    projectId: string,
    executionId: string,
    record: { id: string; sequenceNo: number; createdAt: string; event: AgentEvent },
  ): Promise<void>;
}

export type ExecutionStatusEvent = { executionId: string; workItemId: string; status: AgentExecution['status'] };
export type ExecutionEventSink = (
  channel: 'execution:status_changed' | 'execution:event_received' | 'graph:revision_updated',
  payload: ExecutionStatusEvent | { executionId: string; event: AgentEvent } | { projectId: string; revision: number },
) => void;
