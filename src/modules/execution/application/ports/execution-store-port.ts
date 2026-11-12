import type { WorkItem } from '../../../knowledge/index.js';
import type { AutonomyPolicy, ApprovalRequest } from '../../domain/governance.js';
import type { AgentEvent, AgentExecution, ExecutionFileDiff } from '../../domain/models.js';
import type { TaskOutcome } from '../../domain/task-outcome.js';
import type { AgentExecutionProfile } from './agent-execution-port.js';

/**
 * Everything the execution flow reads and writes in the workspace (A3: split by concern, each port with at most eight
 * methods; the SQLite repository implements them all).
 */
export interface AgentExecutionRepositoryPort
  extends ExecutionProfilePort,
    ExecutionPolicyStorePort,
    ApprovalStorePort,
    WorkItemGraphPort,
    IntegrationBranchStorePort,
    TaskOutcomeStorePort,
    ExecutionRecordPort,
    ExecutionTrailPort {}

/** The wired provider and the DEVELOPER profile of a project. */
export interface ExecutionProfilePort {
  listProfiles(projectId: string): AgentExecutionProfile[];
  findProfile(projectId: string, profileId: string): AgentExecutionProfile | null;
  /** Sets `authMode` in the wired provider's connection config. */
  setProviderAuthMode(projectId: string, mode: 'subscription' | 'api_key'): void;
}

/** The execution policy of a profile. */
export interface ExecutionPolicyStorePort {
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
}

/** Approval requests of runs that ask before acting. */
export interface ApprovalStorePort {
  createApprovalRequest(request: ApprovalRequest): void;
  resolveApprovalRequest(requestId: string, decision: { approved: boolean; resolvedBy: string; note: string }): void;
  /** Closes approval requests left PENDING by an execution that will never resume. */
  rejectPendingApprovals(executionId: string, note: string): void;
}

/** The tasks, their dependencies and features, and the project documents, as the execution flow sees them. */
export interface WorkItemGraphPort {
  findWorkItem(projectId: string, workItemId: string): WorkItem | null;
  /** Moves a work item through the WorkItem state machine; bumps and returns the graph revision. */
  transitionWorkItem(
    projectId: string,
    workItemId: string,
    to: import('../../../knowledge/index.js').WorkItemStatus,
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
  /** Repository paths of the project's Markdown documents (artifacts and decision records). */
  listDocumentPaths(projectId: string): string[];
}

/** The project repository and the integration branch of each feature. */
export interface IntegrationBranchStorePort {
  getRepositoryRoot(projectId: string): string | null;
  getRepositoryId(projectId: string): string | null;
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
}

/** What an accepted task leaves in the graph. */
export interface TaskOutcomeStorePort {
  /**
   * Stores the outcome of an accepted task and its evidence in the graph: a CODE_REFERENCE per changed file with a
   * MODIFIES edge (GENERATED_BY for the project's documents), provenance EXECUTION. Bumps and returns the graph revision.
   */
  recordTaskOutcome(outcome: TaskOutcome, repositoryId: string): number;
  findTaskOutcome(workItemId: string): TaskOutcome | null;
}

/** Run records and their engine sessions. */
export interface ExecutionRecordPort {
  createExecution(execution: AgentExecution): void;
  updateExecution(execution: AgentExecution): void;
  findExecution(executionId: string): AgentExecution | null;
  listExecutions(projectId: string): AgentExecution[];
  /** Engine-side id of an agent session (what `--resume` takes). */
  externalSessionId(sessionId: string): string | null;
}

/** What a run left behind: its events and its file diffs. */
export interface ExecutionTrailPort {
  appendEvent(executionId: string, event: AgentEvent): { id: string; sequenceNo: number; createdAt: string };
  listEvents(executionId: string): Array<{ id: string; sequenceNo: number; createdAt: string; event: AgentEvent }>;
  listFileDiffs(
    executionId: string,
  ): Array<{ filePath: string; changeType: string; additions: number; deletions: number; diffPatch: string | null }>;
  recordFileDiffs(
    executionId: string,
    repositoryId: string,
    diffs: Array<Pick<ExecutionFileDiff, 'filePath' | 'changeType' | 'additions' | 'deletions' | 'diffPatch'>>,
  ): void;
}
