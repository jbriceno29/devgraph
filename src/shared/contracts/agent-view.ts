export type AgentExecutionStatusDto='QUEUED'|'PREPARING_CONTEXT'|'RUNNING'|'AWAITING_APPROVAL'|'VALIDATING'|'COMPLETED'|'FAILED'|'CANCELLED';
export type AgentProfileRoleDto='PLANNER'|'ARCHITECT'|'DEVELOPER'|'REVIEWER'|'KNOWLEDGE_MANAGER';
export interface AgentCapabilitiesDto {supportsResume:boolean;supportsStreaming:boolean;supportsApprovals:boolean;supportsCancellation:boolean;supportsStructuredOutput:boolean;supportsWorktrees:boolean}
export interface AgentProfileDto {id:string;projectId:string;roleKey:AgentProfileRoleDto;name:string;defaultProviderId:string|null;providerId:string;providerName:string;capabilities:AgentCapabilitiesDto}
export interface AgentExecutionDto {id:string;projectId:string;workItemId:string|null;profileId:string;providerId:string;sessionId:string|null;contextSnapshotId:string|null;status:AgentExecutionStatusDto;modelUsed:string|null;initialCommit:string;finalCommit:string|null;branchOrWorktree:string|null;resultSummary:string|null;startedAt:string|null;completedAt:string|null}
export interface AgentEventDto {type:string;timestamp:string;[key:string]:unknown}
export interface AgentEventRecordDto {id:string;sequenceNo:number;createdAt:string;event:AgentEventDto}
export interface StartAgentExecutionInput {projectId:string;workItemId:string;profileId:string}
