export type AgentExecutionStatusDto='QUEUED'|'PREPARING_CONTEXT'|'RUNNING'|'AWAITING_APPROVAL'|'VALIDATING'|'COMPLETED'|'FAILED'|'CANCELLED';
export type AgentProfileRoleDto='PLANNER'|'ARCHITECT'|'DEVELOPER'|'REVIEWER'|'KNOWLEDGE_MANAGER';
export interface AgentCapabilitiesDto {supportsResume:boolean;supportsStreaming:boolean;supportsApprovals:boolean;supportsCancellation:boolean;supportsStructuredOutput:boolean;supportsWorktrees:boolean}
export interface AgentProfileDto {id:string;projectId:string;roleKey:AgentProfileRoleDto;name:string;defaultProviderId:string|null;providerId:string;providerName:string;capabilities:AgentCapabilitiesDto;defaultModel:string|null;planningModel:string|null;availableModels:string[]}
export interface AgentExecutionDto {id:string;projectId:string;workItemId:string|null;profileId:string;providerId:string;sessionId:string|null;contextSnapshotId:string|null;status:AgentExecutionStatusDto;modelUsed:string|null;initialCommit:string;finalCommit:string|null;branchOrWorktree:string|null;baseBranch:string|null;executionBranch:string|null;revisionOf:string|null;reviewStatus:'ACCEPTED'|'CHANGES_REQUESTED'|'MERGE_CONFLICT'|null;reviewNote:string|null;mergedCommit:string|null;reviewedAt:string|null;resultSummary:string|null;startedAt:string|null;completedAt:string|null}
export interface AgentEventDto {type:string;timestamp:string;[key:string]:unknown}
export interface AgentEventRecordDto {id:string;sequenceNo:number;createdAt:string;event:AgentEventDto}
export interface StartAgentExecutionInput {projectId:string;workItemId:string;profileId:string;model?:string}
export interface RequestExecutionChangesInput {executionId:string;feedback:string;model?:string}
export interface AcceptExecutionResultDto {execution:AgentExecutionDto;merged:boolean;conflict:{reason:string;detail:string;files:string[]}|null}
export interface ExecutionDetailDto {execution:AgentExecutionDto;taskStatus:string|null;files:Array<{path:string;changeType:string;additions:number;deletions:number;patch:string|null}>;testLog:string|null;deniedActions:Array<{toolName:string;target:string;reason:string}>;canAccept:boolean;canRequestChanges:boolean}
export interface ExecutionPolicyDto {writablePaths:string[];readonlyPaths:string[];deniedPaths:string[];allowedCommands:string[]}
export interface ResolveExecutionApprovalInput {executionId:string;requestId:string;decision:{approved:true;scope:'ONCE'|'SESSION';note?:string}|{approved:false;reason:string}}
