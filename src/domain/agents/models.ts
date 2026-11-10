import type { WorkItemType } from '../work-management/entities.js';
export type AgentProviderId = 'codex'|'claude-code'|'opencode';
export type AgentProfileRole = 'PLANNER'|'ARCHITECT'|'DEVELOPER'|'REVIEWER'|'KNOWLEDGE_MANAGER';
export interface AgentProfile { id: string; projectId: string; roleKey: AgentProfileRole; name: string; systemInstructions: string; defaultProviderId: string|null; defaultPolicyId: string|null }
export interface AgentCapabilities { supportsResume: boolean; supportsStreaming: boolean; supportsApprovals: boolean; supportsCancellation: boolean; supportsStructuredOutput: boolean; supportsWorktrees: boolean }
export type ExecutionStatus = 'QUEUED'|'PREPARING_CONTEXT'|'RUNNING'|'AWAITING_APPROVAL'|'VALIDATING'|'COMPLETED'|'FAILED'|'CANCELLED';
export interface AgentExecution { id: string; projectId: string; workItemId: string|null; profileId: string; providerId: string; sessionId: string|null; contextSnapshotId: string|null; status: ExecutionStatus; modelUsed: string|null; initialCommit: string; finalCommit: string|null; branchOrWorktree: string|null; testSummary: unknown|null; resultSummary: string|null; startedAt: string|null; completedAt: string|null }
export interface TestExecutionReport { command: string; passed: number; failed: number; skipped: number; exitCode: number; logFilePath: string }
export interface WorkspaceIsolation { mode: 'WORKTREE'|'BRANCH'|'IN_PLACE'; workingDir: string; branchName: string; baseCommit: string; finalCommit?: string }
export type AgentEvent =
 | { type:'SESSION_INITIALIZED'; timestamp:string; externalSessionId:string; model?:string }
 | { type:'TEXT_DELTA'; timestamp:string; delta:string }
 | { type:'TOOL_INVOCATION_STARTED'; timestamp:string; callId:string; toolName:string; args:Record<string,unknown> }
 | { type:'TOOL_INVOCATION_FINISHED'; timestamp:string; callId:string; resultPreview:string; isError:boolean }
 | { type:'FILE_TOUCHED'; timestamp:string; relativePath:string; operation:'CREATE'|'EDIT'|'DELETE' }
 | { type:'APPROVAL_REQUIRED'; timestamp:string; requestId:string; actionType:'COMMAND'|'FILE_WRITE'|'NETWORK'; target:string; justification?:string }
 | { type:'CHANGESET_PROPOSED'; timestamp:string; proposal:import('../knowledge/change-set.js').ChangeSet }
 | { type:'EXECUTION_FINISHED'; timestamp:string; summary:string; usage?:{inputTokens:number;outputTokens:number} }
 | { type:'EXECUTION_FAILED'; timestamp:string; errorCode:string; errorMessage:string; isRecoverable:boolean };
const transitions: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> = { QUEUED:['PREPARING_CONTEXT','CANCELLED'], PREPARING_CONTEXT:['RUNNING','FAILED','CANCELLED'], RUNNING:['AWAITING_APPROVAL','VALIDATING','FAILED','CANCELLED'], AWAITING_APPROVAL:['RUNNING','FAILED','CANCELLED'], VALIDATING:['COMPLETED','FAILED','CANCELLED'], COMPLETED:[], FAILED:[], CANCELLED:[] };
export function canTransitionExecution(from: ExecutionStatus, to: ExecutionStatus): boolean { return transitions[from].includes(to); }
export function transitionExecution(execution: AgentExecution, to: ExecutionStatus): AgentExecution {
 if (!canTransitionExecution(execution.status,to)) throw new Error(`Invalid AgentExecution transition: ${execution.status} -> ${to}`);
 return {...execution,status:to};
}
export interface AgentProvider { id:string; providerKey:AgentProviderId; displayName:string; adapterVersion:string; capabilities:AgentCapabilities }
export interface ProviderConnection { id:string; providerId:string; executablePath:string|null; serverUrl:string|null; config:Record<string,unknown>|null; healthStatus:'UNKNOWN'|'HEALTHY'|'UNHEALTHY'; lastCheckedAt:string|null }
export interface AgentSession { id:string; projectId:string; providerId:string; profileId:string; externalSessionId:string|null; status:'ACTIVE'|'PAUSED'|'CLOSED'|'FAILED'; createdAt:string; lastActiveAt:string }
export interface ExecutionFileDiff { id:string; executionId:string; repositoryId:string; filePath:string; changeType:'ADDED'|'MODIFIED'|'DELETED'|'RENAMED'; additions:number; deletions:number; diffPatch:string|null }
