import type { GraphEdgeType, GraphNodeView, GraphEdgeView, KnowledgeEntityType } from './graph-view.js';
import type { ArtifactDocumentDto, ArtifactDocumentViewDto, ArtifactSyncStatusChangedDto, CreateArtifactDocumentInput } from './artifact-view.js';
import type { ContextPackageDto,ContextSnapshotDto,PreviewContextInput } from './context-view.js';
import type { AgentEventDto,AgentExecutionDto,AgentEventRecordDto,AgentProfileDto,StartAgentExecutionInput,ResolveExecutionApprovalInput,RequestExecutionChangesInput,AcceptExecutionResultDto,ExecutionDetailDto,ExecutionPolicyDto,FeaturePilotDto,FeatureReportDto,FeatureAutonomyDto,SetFeatureAutonomyInput,PilotRunDto } from './agent-view.js';

export interface CreateProjectInput { name:string; slug:string; description?:string; objectives?:string[]; techStack?:Record<string,unknown>; rules?:string[] }
export interface ProjectSummaryDto { id:string; name:string; slug:string; description:string|null; currentRevision:number; createdAt:string; updatedAt:string }
export interface GraphFilterDto { entityTypes?:KnowledgeEntityType[]; edgeTypes?:GraphEdgeType[] }
export interface GraphViewDto { projectId:string; revision:number; nodes:GraphNodeView[]; edges:GraphEdgeView[] }
export interface RelationshipViewDto { id:string; sourceId:string; sourceLabel:string; targetId:string; targetLabel:string; type:GraphEdgeType; direction:'INCOMING'|'OUTGOING'; provenance:'USER'|'CHANGESET'|'EXECUTION' }
export interface EntityInspectorDto { entity:GraphNodeView & {summary:string}; attributes:Record<string,unknown>; relationships:RelationshipViewDto[]; allowedStatusChanges?:string[]; outcome?:{summary:string;files:Array<{path:string;status:string}>;checks:Array<{command:string;passed:boolean}>;mergedCommit:string|null;integrationBranch:string|null;createdAt:string}; executionHistory:Array<{id:string;status:string;startedAt:string|null;completedAt:string|null;resultSummary:string|null}> }
export interface WorkspaceLoadedStateDto { project:ProjectSummaryDto; graph:GraphViewDto; selectedEntityId:string }
export interface ChangeSetDto { id:string;projectId:string;baseGraphRevision:number;appliedGraphRevision?:number;originType:'AI_CHAT'|'AGENT_EXECUTION'|'USER_BULK_ACTION';title:string;rationale:string;status:'PENDING_APPROVAL'|'VALIDATED'|'CONFLICTED'|'APPLIED'|'REJECTED';operations:Array<Record<string,unknown>>;validationIssues:Array<{operationIndex:number;severity:'ERROR'|'WARNING';code:string;message:string}>;createdAt:string;appliedAt?:string }
export interface WorkspaceIpcCommands {
  'project:create': (input:CreateProjectInput)=>Promise<ProjectSummaryDto>;
  'project:open': (projectId:string)=>Promise<WorkspaceLoadedStateDto>;
  'repository:configure': (projectId:string,localPath:string)=>Promise<{projectId:string;localPath:string}>;
  'artifact:create': (input:CreateArtifactDocumentInput)=>Promise<ArtifactDocumentViewDto>;
  'artifact:save': (documentId:string,expectedContentHash:string,content:string)=>Promise<ArtifactDocumentViewDto>;
  'changeset:propose_from_chat': (projectId:string,prompt:string,focusEntityId?:string,contextSnapshotId?:string,model?:string)=>Promise<ChangeSetDto>;
  'changeset:edit': (changeSetId:string,operations:unknown[])=>Promise<ChangeSetDto>;
  'changeset:apply': (changeSetId:string)=>Promise<{changeSet:ChangeSetDto;revision:number}>;
  'changeset:reject': (changeSetId:string)=>Promise<ChangeSetDto>;
  'execution:start': (input:StartAgentExecutionInput)=>Promise<AgentExecutionDto>;
  'execution:cancel': (executionId:string)=>Promise<AgentExecutionDto>;
  'execution:resolve_approval': (input:ResolveExecutionApprovalInput)=>Promise<{resolved:true}>;
  'execution:accept': (executionId:string)=>Promise<AcceptExecutionResultDto>;
  'execution:request_changes': (input:RequestExecutionChangesInput)=>Promise<AgentExecutionDto>;
  'workitem:set_status': (projectId:string,workItemId:string,status:string)=>Promise<{status:string;revision:number}>;
  'policy:update': (projectId:string,policy:ExecutionPolicyDto)=>Promise<ExecutionPolicyDto>;
  'pilot:set_autonomy': (projectId:string,featureId:string,input:SetFeatureAutonomyInput)=>Promise<FeatureAutonomyDto>;
  'pilot:start': (projectId:string,featureId:string,input:{acknowledgeCost:boolean})=>Promise<PilotRunDto>;
  'pilot:stop': (projectId:string,featureId:string)=>Promise<PilotRunDto|null>;
  'pilot:resume': (projectId:string,featureId:string)=>Promise<PilotRunDto>;
  'metrics:export_report': (projectId:string,featureId:string)=>Promise<{path:string}>;
  'provider:set_auth_mode': (projectId:string,mode:'subscription'|'api_key')=>Promise<{authMode:'subscription'|'api_key'}>;
}
export interface WorkspaceIpcQueries {
  'project:list': ()=>Promise<ProjectSummaryDto[]>;
  'graph:get_view': (projectId:string,filter?:GraphFilterDto)=>Promise<GraphViewDto>;
  'entity:get_inspector_details': (entityId:string)=>Promise<EntityInspectorDto>;
  'repository:get_path': (projectId:string)=>Promise<string|null>;
  'artifact:list': (projectId:string)=>Promise<ArtifactDocumentDto[]>;
  'artifact:read': (documentId:string)=>Promise<ArtifactDocumentViewDto>;
  'changeset:list': (projectId:string)=>Promise<ChangeSetDto[]>;
  'context:get_snapshot': (snapshotId:string)=>Promise<ContextSnapshotDto>;
  'context:preview_package': (input:PreviewContextInput)=>Promise<ContextPackageDto>;
  'agent:list_profiles': (projectId:string)=>Promise<AgentProfileDto[]>;
  'execution:list': (projectId:string)=>Promise<AgentExecutionDto[]>;
  'execution:list_events': (executionId:string)=>Promise<AgentEventRecordDto[]>;
  'execution:get_detail': (executionId:string)=>Promise<ExecutionDetailDto>;
  'policy:get': (projectId:string)=>Promise<ExecutionPolicyDto>;
  'pilot:get': (projectId:string,featureId:string)=>Promise<FeaturePilotDto>;
  'metrics:feature_report': (projectId:string,featureId:string)=>Promise<FeatureReportDto>;
}
export interface WorkspaceIpcEvents {
  'graph:revision_updated': {projectId:string;revision:number};
  'artifact:sync_status_changed': ArtifactSyncStatusChangedDto;
  'execution:status_changed': {executionId:string;workItemId:string;status:AgentExecutionDto['status']};
  'execution:event_received': {executionId:string;event:AgentEventDto};
  'pilot:updated': {projectId:string;featureId:string;status:string|null};
}
export type IpcCommandChannel=keyof WorkspaceIpcCommands;
export type IpcQueryChannel=keyof WorkspaceIpcQueries;
export type IpcEventChannel=keyof WorkspaceIpcEvents;

export interface WorkspaceIpcClient {
  commands:{
    createProject(input:CreateProjectInput):Promise<ProjectSummaryDto>;
    openProject(projectId:string):Promise<WorkspaceLoadedStateDto>;
    configureRepository(projectId:string,localPath:string):Promise<{projectId:string;localPath:string}>;
    createArtifact(input:CreateArtifactDocumentInput):Promise<ArtifactDocumentViewDto>;
    saveArtifact(documentId:string,expectedContentHash:string,content:string):Promise<ArtifactDocumentViewDto>;
    proposeChanges(projectId:string,prompt:string,focusEntityId?:string,contextSnapshotId?:string,model?:string):Promise<ChangeSetDto>;
    editChangeSet(changeSetId:string,operations:unknown[]):Promise<ChangeSetDto>;
    applyChangeSet(changeSetId:string):Promise<{changeSet:ChangeSetDto;revision:number}>;
    rejectChangeSet(changeSetId:string):Promise<ChangeSetDto>;
    startExecution(input:StartAgentExecutionInput):Promise<AgentExecutionDto>;
    cancelExecution(executionId:string):Promise<AgentExecutionDto>;
    resolveExecutionApproval(input:ResolveExecutionApprovalInput):Promise<{resolved:true}>;
    acceptExecution(executionId:string):Promise<AcceptExecutionResultDto>;
    requestExecutionChanges(input:RequestExecutionChangesInput):Promise<AgentExecutionDto>;
    setWorkItemStatus(projectId:string,workItemId:string,status:string):Promise<{status:string;revision:number}>;
    updateExecutionPolicy(projectId:string,policy:ExecutionPolicyDto):Promise<ExecutionPolicyDto>;
    setFeatureAutonomy(projectId:string,featureId:string,input:SetFeatureAutonomyInput):Promise<FeatureAutonomyDto>;
    startPilot(projectId:string,featureId:string,input:{acknowledgeCost:boolean}):Promise<PilotRunDto>;
    stopPilot(projectId:string,featureId:string):Promise<PilotRunDto|null>;
    resumePilot(projectId:string,featureId:string):Promise<PilotRunDto>;
    setAuthMode(projectId:string,mode:'subscription'|'api_key'):Promise<{authMode:'subscription'|'api_key'}>;
    exportFeatureReport(projectId:string,featureId:string):Promise<{path:string}>;
  };
  queries:{
    listProjects():Promise<ProjectSummaryDto[]>;
    getGraphView(projectId:string,filter?:GraphFilterDto):Promise<GraphViewDto>;
    getEntityInspectorDetails(entityId:string):Promise<EntityInspectorDto>;
    getRepositoryPath(projectId:string):Promise<string|null>;
    listArtifacts(projectId:string):Promise<ArtifactDocumentDto[]>;
    getArtifact(documentId:string):Promise<ArtifactDocumentViewDto>;
    listChangeSets(projectId:string):Promise<ChangeSetDto[]>;
    getContextSnapshot(snapshotId:string):Promise<ContextSnapshotDto>;
    previewContext(input:PreviewContextInput):Promise<ContextPackageDto>;
    listAgentProfiles(projectId:string):Promise<AgentProfileDto[]>;
    listExecutions(projectId:string):Promise<AgentExecutionDto[]>;
    listExecutionEvents(executionId:string):Promise<AgentEventRecordDto[]>;
    getExecutionDetail(executionId:string):Promise<ExecutionDetailDto>;
    getExecutionPolicy(projectId:string):Promise<ExecutionPolicyDto>;
    getFeaturePilot(projectId:string,featureId:string):Promise<FeaturePilotDto>;
    getFeatureReport(projectId:string,featureId:string):Promise<FeatureReportDto>;
  };
  events:{onGraphRevisionUpdated(listener:(event:WorkspaceIpcEvents['graph:revision_updated'])=>void):()=>void;onArtifactSyncStatusChanged(listener:(event:WorkspaceIpcEvents['artifact:sync_status_changed'])=>void):()=>void;onExecutionStatusChanged(listener:(event:WorkspaceIpcEvents['execution:status_changed'])=>void):()=>void;onExecutionEventReceived(listener:(event:WorkspaceIpcEvents['execution:event_received'])=>void):()=>void;onPilotUpdated(listener:(event:WorkspaceIpcEvents['pilot:updated'])=>void):()=>void};
}
