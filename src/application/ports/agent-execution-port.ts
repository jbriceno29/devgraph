import type { AgentExecution, AgentEvent, AgentProfile, AgentProvider, ExecutionFileDiff } from '../../domain/agents/models.js';
import type { WorkItem } from '../../domain/work-management/entities.js';
import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
import type { AutonomyPolicy,ApprovalRequest } from '../../domain/governance/models.js';

export interface AgentExecutionProfile extends AgentProfile {
  provider: AgentProvider;
}

export interface AgentExecutionRepositoryPort {
  listProfiles(projectId: string): AgentExecutionProfile[];
  findProfile(projectId: string, profileId: string): AgentExecutionProfile | null;
  findWorkItem(projectId: string, workItemId: string): WorkItem | null;
  getRepositoryRoot(projectId: string): string | null;
  getRepositoryId(projectId:string):string|null;
  getAutonomyPolicy(projectId:string,profileId:string):AutonomyPolicy;
  createExecution(execution: AgentExecution): void;
  updateExecution(execution: AgentExecution): void;
  findExecution(executionId: string): AgentExecution | null;
  listExecutions(projectId: string): AgentExecution[];
  appendEvent(executionId: string, event: AgentEvent): { id: string; sequenceNo: number; createdAt: string };
  listEvents(executionId: string): Array<{ id: string; sequenceNo: number; createdAt: string; event: AgentEvent }>;
  createApprovalRequest(request:ApprovalRequest):void;
  resolveApprovalRequest(requestId:string,decision:{approved:boolean;resolvedBy:string;note:string}):void;
  recordFileDiffs(executionId:string,repositoryId:string,diffs:Array<Pick<ExecutionFileDiff,'filePath'|'changeType'|'additions'|'deletions'|'diffPatch'>>):void;
}

export interface GitIsolationPort {
  prepare(input:{projectId:string;executionId:string;workItemKey:string;repositoryRoot:string;workspaceRoot:string;requireWorktree:boolean}):Promise<{workingDirectory:string;branchName:string;baseCommit:string}>;
  /** Removes a worktree and branch created by `prepare` that never received agent work. */
  discard(input:{repositoryRoot:string;workspaceRoot:string;workingDirectory:string;branchName:string}):Promise<void>;
}
export interface ExecutionValidatorPort { validate(input:{projectId:string;executionId:string;workingDirectory:string;repositoryRoot:string;repositoryId:string;initialCommit:string;policy:AutonomyPolicy}):Promise<{passed:boolean;finalCommit:string|null;resultSummary:string;testSummary:unknown|null}> }

export interface AgentContextBuilderPort {
  build(input: { projectId: string; focusEntityId: string; repositoryRoot: string; executionId: string }): Promise<{ snapshot: ContextSnapshot; packageText: string }>;
}

export interface ExecutionEventLogPort {
  append(projectId: string, executionId: string, record: { id: string; sequenceNo: number; createdAt: string; event: AgentEvent }): Promise<void>;
}

export type ExecutionStatusEvent = { executionId: string; workItemId: string; status: AgentExecution['status'] };
export type ExecutionEventSink = (channel: 'execution:status_changed' | 'execution:event_received', payload: ExecutionStatusEvent | { executionId: string; event: AgentEvent }) => void;
