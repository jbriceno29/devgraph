import type { AgentExecution, AgentEvent, AgentProfile, AgentProvider, ExecutionFileDiff } from '../../domain/agents/models.js';
import type { WorkItem } from '../../domain/work-management/entities.js';
import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
import type { AutonomyPolicy,ApprovalRequest } from '../../domain/governance/models.js';

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
  getRepositoryId(projectId:string):string|null;
  getAutonomyPolicy(projectId:string,profileId:string):AutonomyPolicy;
  updateAutonomyPolicy(policyId:string,fields:Pick<AutonomyPolicy,'writablePaths'|'readonlyPaths'|'deniedPaths'|'allowedCommands'>):void;
  createExecution(execution: AgentExecution): void;
  updateExecution(execution: AgentExecution): void;
  findExecution(executionId: string): AgentExecution | null;
  listExecutions(projectId: string): AgentExecution[];
  appendEvent(executionId: string, event: AgentEvent): { id: string; sequenceNo: number; createdAt: string };
  listEvents(executionId: string): Array<{ id: string; sequenceNo: number; createdAt: string; event: AgentEvent }>;
  createApprovalRequest(request:ApprovalRequest):void;
  resolveApprovalRequest(requestId:string,decision:{approved:boolean;resolvedBy:string;note:string}):void;
  /** Moves a work item through the WorkItem state machine; bumps and returns the graph revision. */
  transitionWorkItem(projectId:string,workItemId:string,to:import('../../domain/work-management/entities.js').WorkItemStatus):number;
  /** Work items this one DEPENDS_ON (direct edges only). */
  listDependencies(projectId:string,workItemId:string):Array<{id:string;displayKey:string;title:string;status:string}>;
  /** Work items that DEPEND_ON this one. */
  listDependents(projectId:string,workItemId:string):Array<{id:string;displayKey:string;title:string;status:string}>;
  /** Nearest FEATURE ancestor of a work item (following parent links), or null. */
  findFeatureFor(projectId:string,workItemId:string):{id:string;displayKey:string;title:string}|null;
  /** Integration branch owned by a feature (or by a work item without a feature). */
  getIntegrationBranch(ownerId:string):{branchName:string;sourceBranch:string}|null;
  saveIntegrationBranch(input:{ownerId:string;projectId:string;repositoryId:string;branchName:string;sourceBranch:string}):void;
  listFileDiffs(executionId:string):Array<{filePath:string;changeType:string;additions:number;deletions:number;diffPatch:string|null}>;
  recordFileDiffs(executionId:string,repositoryId:string,diffs:Array<Pick<ExecutionFileDiff,'filePath'|'changeType'|'additions'|'deletions'|'diffPatch'>>):void;
}

export interface GitIsolationPort {
  prepare(input:{projectId:string;executionId:string;workItemKey:string;repositoryRoot:string;workspaceRoot:string;requireWorktree:boolean;startPoint?:string}):Promise<{workingDirectory:string;branchName:string;baseCommit:string;baseBranch:string|null}>;
  /** Removes a worktree and branch created by `prepare` that never received agent work. */
  discard(input:{repositoryRoot:string;workspaceRoot:string;workingDirectory:string;branchName:string}):Promise<void>;
  currentBranch(repositoryRoot:string):Promise<string|null>;
  branchExists(repositoryRoot:string,branchName:string):Promise<boolean>;
  createIntegrationBranch(input:{repositoryRoot:string;preferredName:string;sourceRef:string}):Promise<string>;
  squashMerge(input:{repositoryRoot:string;workspaceRoot:string;projectId:string;targetBranch:string;sourceRef:string;message:string}):Promise<{ok:true;commit:string;changed:boolean}|{ok:false;reason:'CONFLICT'|'CHECKED_OUT';detail:string;conflicts:string[]}>;
}
export interface ExecutionValidatorPort { validate(input:{projectId:string;executionId:string;workingDirectory:string;repositoryRoot:string;repositoryId:string;initialCommit:string;policy:AutonomyPolicy;commitMessage?:string}):Promise<{passed:boolean;finalCommit:string|null;resultSummary:string;testSummary:unknown|null}> }

export interface AgentContextBuilderPort {
  build(input: { projectId: string; focusEntityId: string; repositoryRoot: string; executionId: string }): Promise<{ snapshot: ContextSnapshot; packageText: string }>;
}

export interface ExecutionEventLogPort {
  append(projectId: string, executionId: string, record: { id: string; sequenceNo: number; createdAt: string; event: AgentEvent }): Promise<void>;
}

export type ExecutionStatusEvent = { executionId: string; workItemId: string; status: AgentExecution['status'] };
export type ExecutionEventSink = (channel: 'execution:status_changed' | 'execution:event_received' | 'graph:revision_updated', payload: ExecutionStatusEvent | { executionId: string; event: AgentEvent } | { projectId: string; revision: number }) => void;
