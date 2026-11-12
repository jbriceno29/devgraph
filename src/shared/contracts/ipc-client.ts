import type { ContextFlowDto } from './graph-view.js';
import type { ArtifactDocumentDto, ArtifactDocumentViewDto, CreateArtifactDocumentInput } from './artifact-view.js';
import type { ContextPackageDto, ContextSnapshotDto, PreviewContextInput } from './context-view.js';
import type { ActivitySummaryDto } from './activity-view.js';
import type { AgentAccessProposalDto } from './repository-scan.js';
import type { EntityInspectorDto } from './inspector-view.js';
import type { IpcExtensionCommands } from './ipc-extensions.js';
import type { InceptionReferenceDto, InceptionReferenceInput, InceptionIpcClient } from './inception-view.js';
import type {
  AgentExecutionDto,
  AgentEventRecordDto,
  AgentProfileDto,
  StartAgentExecutionInput,
  ResolveExecutionApprovalInput,
  RequestExecutionChangesInput,
  AcceptExecutionResultDto,
  ExecutionDetailDto,
  ExecutionPolicyDto,
  FeaturePilotDto,
  FeatureReportDto,
  FeatureAutonomyDto,
  SetFeatureAutonomyInput,
  PilotRunDto,
  ProjectEnvironmentDto,
  CommandRunDto,
  ProjectScriptsDto,
} from './agent-view.js';
import {
  ProposeChangesOptions,
  CreateProjectInput,
  AppSettingsDto,
  FolderInspectionDto,
  ProjectSummaryDto,
  GraphFilterDto,
  GraphViewDto,
  WorkspaceLoadedStateDto,
  ChangeSetDto,
} from './workspace-dtos.js';
import { WorkspaceIpcEvents } from './ipc-contracts.js';

export interface WorkspaceIpcClient {
  commands: IpcExtensionCommands & {
    createProject(input: CreateProjectInput): Promise<ProjectSummaryDto>;
    openProject(projectId: string): Promise<WorkspaceLoadedStateDto>;
    /** Optional so existing fakes stay valid; without it the app asks for a path in each project, as before. */
    setProjectsFolder?(path: string): Promise<AppSettingsDto>;
    configureRepository(projectId: string, localPath: string): Promise<{ projectId: string; localPath: string }>;
    createArtifact(input: CreateArtifactDocumentInput): Promise<ArtifactDocumentViewDto>;
    saveArtifact(documentId: string, expectedContentHash: string, content: string): Promise<ArtifactDocumentViewDto>;
    proposeChanges(
      projectId: string,
      prompt: string,
      focusEntityId?: string,
      contextSnapshotId?: string,
      model?: string,
      options?: ProposeChangesOptions,
    ): Promise<ChangeSetDto>;
    /** Optional so existing fakes stay valid; the Tauri client implements it. */
    translateReferences?(projectId: string, references: InceptionReferenceInput[]): Promise<InceptionReferenceDto[]>;
    editChangeSet(changeSetId: string, operations: unknown[]): Promise<ChangeSetDto>;
    applyChangeSet(changeSetId: string): Promise<{ changeSet: ChangeSetDto; revision: number }>;
    rejectChangeSet(changeSetId: string): Promise<ChangeSetDto>;
    startExecution(input: StartAgentExecutionInput): Promise<AgentExecutionDto>;
    cancelExecution(executionId: string): Promise<AgentExecutionDto>;
    resolveExecutionApproval(input: ResolveExecutionApprovalInput): Promise<{ resolved: true }>;
    acceptExecution(executionId: string): Promise<AcceptExecutionResultDto>;
    requestExecutionChanges(input: RequestExecutionChangesInput): Promise<AgentExecutionDto>;
    setWorkItemStatus(
      projectId: string,
      workItemId: string,
      status: string,
    ): Promise<{ status: string; revision: number }>;
    /** Accept, reject, supersede or reopen an ADR. Optional so existing fakes stay valid; the Tauri client implements it. */
    setDecisionStatus?(
      projectId: string,
      decisionId: string,
      status: string,
    ): Promise<{ status: string; revision: number }>;
    updateExecutionPolicy(projectId: string, policy: ExecutionPolicyDto): Promise<ExecutionPolicyDto>;
    /** Plan S2: approve packages outside the stack profile. Optional so existing fakes stay valid; the Tauri client implements it. */
    approveDependencies?(projectId: string, packages: string[]): Promise<ProjectEnvironmentDto>;
    /** Plan S4: turn the bundled skills on or off for the project's interface tasks. Optional so existing fakes stay valid. */
    setProjectSkills?(projectId: string, enabled: boolean): Promise<ProjectEnvironmentDto>;
    /** Project commands from the app. Optional so existing fakes stay valid; the Tauri client implements them. */
    startCommand?(projectId: string, input: { ref: string; script: string }): Promise<CommandRunDto>;
    stopCommand?(projectId: string, runId: string): Promise<CommandRunDto>;
    setFeatureAutonomy(
      projectId: string,
      featureId: string,
      input: SetFeatureAutonomyInput,
    ): Promise<FeatureAutonomyDto>;
    startPilot(projectId: string, featureId: string, input: { acknowledgeCost: boolean }): Promise<PilotRunDto>;
    stopPilot(projectId: string, featureId: string): Promise<PilotRunDto | null>;
    resumePilot(projectId: string, featureId: string): Promise<PilotRunDto>;
    setAuthMode(projectId: string, mode: 'subscription' | 'api_key'): Promise<{ authMode: 'subscription' | 'api_key' }>;
    exportFeatureReport(projectId: string, featureId: string): Promise<{ path: string }>;
  };
  queries: {
    listProjects(): Promise<ProjectSummaryDto[]>;
    getGraphView(projectId: string, filter?: GraphFilterDto): Promise<GraphViewDto>;
    getEntityInspectorDetails(entityId: string): Promise<EntityInspectorDto>;
    getRepositoryPath(projectId: string): Promise<string | null>;
    listArtifacts(projectId: string): Promise<ArtifactDocumentDto[]>;
    getArtifact(documentId: string): Promise<ArtifactDocumentViewDto>;
    listChangeSets(projectId: string): Promise<ChangeSetDto[]>;
    getContextSnapshot(snapshotId: string): Promise<ContextSnapshotDto>;
    previewContext(input: PreviewContextInput): Promise<ContextPackageDto>;
    listAgentProfiles(projectId: string): Promise<AgentProfileDto[]>;
    listExecutions(projectId: string): Promise<AgentExecutionDto[]>;
    listExecutionEvents(executionId: string): Promise<AgentEventRecordDto[]>;
    getExecutionDetail(executionId: string): Promise<ExecutionDetailDto>;
    getExecutionPolicy(projectId: string): Promise<ExecutionPolicyDto>;
    /** Plan REP R1: writable paths and checks read from the repository (nothing is saved). Optional for older fakes. */
    proposeAccessFromRepository?(projectId: string): Promise<AgentAccessProposalDto>;
    /** Plan S2: stack profile and approved packages. Optional so existing fakes stay valid. */
    getProjectEnvironment?(projectId: string): Promise<ProjectEnvironmentDto>;
    getCommandRefs?(projectId: string): Promise<{ refs: string[]; current: string | null }>;
    getProjectScripts?(projectId: string, ref: string): Promise<ProjectScriptsDto>;
    listCommands?(projectId: string): Promise<CommandRunDto[]>;
    getFeaturePilot(projectId: string, featureId: string): Promise<FeaturePilotDto>;
    /** How the engine authenticates for the project (works without features, unlike getFeaturePilot). Optional so older client fakes stay valid. */
    getProviderAuth?(projectId: string): Promise<{ authMode: 'subscription' | 'api_key'; apiKeyAvailable: boolean }>;
    getContextFlow(projectId: string, workItemId: string): Promise<ContextFlowDto>;
    getFeatureReport(projectId: string, featureId: string): Promise<FeatureReportDto>;
    getActivity(projectId: string, limit?: number): Promise<ActivitySummaryDto>;
    /** Optional so existing fakes stay valid. */
    getAppSettings?(): Promise<AppSettingsDto>;
    inspectFolder?(path: string): Promise<FolderInspectionDto>;
  };
  /** Native desktop features outside the core (the Tauri client implements them; absent in tests and in a plain browser). */
  platform?: {
    /** Opens the system's folder picker; null when the user cancels. */
    pickFolder?(options: { title: string; defaultPath?: string }): Promise<string | null>;
  };
  /** Project inception and repository creation (optional so existing fakes stay valid; the Tauri client implements it). */
  inception?: InceptionIpcClient;
  events: {
    onGraphRevisionUpdated(listener: (event: WorkspaceIpcEvents['graph:revision_updated']) => void): () => void;
    onArtifactSyncStatusChanged(
      listener: (event: WorkspaceIpcEvents['artifact:sync_status_changed']) => void,
    ): () => void;
    onExecutionStatusChanged(listener: (event: WorkspaceIpcEvents['execution:status_changed']) => void): () => void;
    onExecutionEventReceived(listener: (event: WorkspaceIpcEvents['execution:event_received']) => void): () => void;
    onPilotUpdated(listener: (event: WorkspaceIpcEvents['pilot:updated']) => void): () => void;
    /** Optional so existing fakes stay valid. */
    onCommandUpdated?(listener: (event: WorkspaceIpcEvents['command:updated']) => void): () => void;
    onCommandOutput?(listener: (event: WorkspaceIpcEvents['command:output']) => void): () => void;
  };
}
