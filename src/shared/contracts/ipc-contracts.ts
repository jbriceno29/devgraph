import type { ContextFlowDto, GraphEdgeType, GraphNodeView, GraphEdgeView, KnowledgeEntityType } from './graph-view.js';
import type {
  ArtifactDocumentDto,
  ArtifactDocumentViewDto,
  ArtifactSyncStatusChangedDto,
  CreateArtifactDocumentInput,
} from './artifact-view.js';
import type { ContextPackageDto, ContextSnapshotDto, PreviewContextInput } from './context-view.js';
import type { ActivitySummaryDto } from './activity-view.js';
import type { RepositoryCorrectionDto, RepositoryScanSummaryDto } from './repository-scan.js';
import type {
  InceptionReferenceDto,
  InceptionReferenceInput,
  InceptionAnswerDto,
  InceptionIpcClient,
  InceptionStage,
  InceptionStatus,
  InceptionViewDto,
  InitializeRepositoryResultDto,
  StartInceptionInput,
} from './inception-view.js';
import type {
  AgentEventDto,
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
  FeatureIntegrationResultDto,
  FeatureIntegrationStateDto,
  ProjectEnvironmentDto,
} from './agent-view.js';

/** Extras of a planning proposal: translated references and the interface specification. */
export interface ProposeChangesOptions {
  references?: Array<
    Pick<InceptionReferenceDto, 'name' | 'kind' | 'note'> & {
      translation: NonNullable<InceptionReferenceDto['translation']>;
    }
  >;
  updateUiSpec?: boolean;
}
export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
  objectives?: string[];
  techStack?: Record<string, unknown>;
  rules?: string[];
}
export interface ProjectSummaryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}
export interface GraphFilterDto {
  entityTypes?: KnowledgeEntityType[];
  edgeTypes?: GraphEdgeType[];
}
export interface GraphViewDto {
  projectId: string;
  revision: number;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}
export interface RelationshipViewDto {
  id: string;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  type: GraphEdgeType;
  direction: 'INCOMING' | 'OUTGOING';
  provenance: 'USER' | 'CHANGESET' | 'EXECUTION';
}
export interface EntityInspectorDto {
  entity: GraphNodeView & { summary: string };
  attributes: Record<string, unknown>;
  relationships: RelationshipViewDto[];
  allowedStatusChanges?: string[];
  outcome?: {
    summary: string;
    files: Array<{ path: string; status: string }>;
    checks: Array<{ command: string; passed: boolean }>;
    mergedCommit: string | null;
    integrationBranch: string | null;
    createdAt: string;
  } /** FEATURE only, when it has an integration branch: what «Integrar» needs (no git calls). */;
  integration?: FeatureIntegrationStateDto;
  executionHistory: Array<{
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    resultSummary: string | null;
  }>;
}
export interface WorkspaceLoadedStateDto {
  project: ProjectSummaryDto;
  graph: GraphViewDto;
  selectedEntityId: string;
}
export interface ChangeSetDto {
  id: string;
  projectId: string;
  baseGraphRevision: number;
  appliedGraphRevision?: number;
  originType: 'AI_CHAT' | 'AGENT_EXECUTION' | 'USER_BULK_ACTION';
  title: string;
  rationale: string;
  status: 'PENDING_APPROVAL' | 'VALIDATED' | 'CONFLICTED' | 'APPLIED' | 'REJECTED';
  operations: Array<Record<string, unknown>>;
  validationIssues: Array<{ operationIndex: number; severity: 'ERROR' | 'WARNING'; code: string; message: string }>;
  createdAt: string;
  appliedAt?: string;
}
export interface WorkspaceIpcCommands {
  'project:create': (input: CreateProjectInput) => Promise<ProjectSummaryDto>;
  'project:open': (projectId: string) => Promise<WorkspaceLoadedStateDto>;
  'repository:configure': (projectId: string, localPath: string) => Promise<{ projectId: string; localPath: string }>;
  'artifact:create': (input: CreateArtifactDocumentInput) => Promise<ArtifactDocumentViewDto>;
  'artifact:save': (
    documentId: string,
    expectedContentHash: string,
    content: string,
  ) => Promise<ArtifactDocumentViewDto>;
  /** `options` (planning a feature on a project in progress): references already translated by `planning:translate_references` (data for the planner) and whether to update docs/UI_SPEC.md (or create it). */
  'changeset:propose_from_chat': (
    projectId: string,
    prompt: string,
    focusEntityId?: string,
    contextSnapshotId?: string,
    model?: string,
    options?: ProposeChangesOptions,
  ) => Promise<ChangeSetDto>;
  /** Translates reference files attached while planning into text with the inception's translator (V1); the files are kept only during the call. Runs concurrently (a model call). */
  'planning:translate_references': (
    projectId: string,
    references: InceptionReferenceInput[],
  ) => Promise<InceptionReferenceDto[]>;
  'changeset:edit': (changeSetId: string, operations: unknown[]) => Promise<ChangeSetDto>;
  'changeset:apply': (changeSetId: string) => Promise<{ changeSet: ChangeSetDto; revision: number }>;
  'changeset:reject': (changeSetId: string) => Promise<ChangeSetDto>;
  'execution:start': (input: StartAgentExecutionInput) => Promise<AgentExecutionDto>;
  'execution:cancel': (executionId: string) => Promise<AgentExecutionDto>;
  'execution:resolve_approval': (input: ResolveExecutionApprovalInput) => Promise<{ resolved: true }>;
  'execution:accept': (executionId: string) => Promise<AcceptExecutionResultDto>;
  'execution:request_changes': (input: RequestExecutionChangesInput) => Promise<AgentExecutionDto>;
  'workitem:set_status': (
    projectId: string,
    workItemId: string,
    status: string,
  ) => Promise<{ status: string; revision: number }>;
  'policy:update': (projectId: string, policy: ExecutionPolicyDto) => Promise<ExecutionPolicyDto>;
  'environment:approve_dependencies': (projectId: string, packages: string[]) => Promise<ProjectEnvironmentDto>;
  'environment:set_skills': (projectId: string, enabled: boolean) => Promise<ProjectEnvironmentDto>;
  'pilot:set_autonomy': (
    projectId: string,
    featureId: string,
    input: SetFeatureAutonomyInput,
  ) => Promise<FeatureAutonomyDto>;
  'pilot:start': (projectId: string, featureId: string, input: { acknowledgeCost: boolean }) => Promise<PilotRunDto>;
  'pilot:stop': (projectId: string, featureId: string) => Promise<PilotRunDto | null>;
  'pilot:resume': (projectId: string, featureId: string) => Promise<PilotRunDto>;
  'metrics:export_report': (projectId: string, featureId: string) => Promise<{ path: string }>;
  /** Merges a feature whose tasks are all DONE into the project's base branch (merge commit, temporary worktree; refuses a dirty checkout). */
  'feature:integrate': (projectId: string, featureId: string) => Promise<FeatureIntegrationResultDto>;
  'provider:set_auth_mode': (
    projectId: string,
    mode: 'subscription' | 'api_key',
  ) => Promise<{ authMode: 'subscription' | 'api_key' }>;
  /** Creates a new Git repository (folder missing or empty, absolute path without ..) and makes it the project's primary one. */
  'repository:initialize': (projectId: string, absolutePath: string) => Promise<InitializeRepositoryResultDto>;
  /** Starts the inception: returns at once with status WORKING; `inception:updated` tells when the questions are ready. */
  'inception:start': (projectId: string, input: StartInceptionInput) => Promise<InceptionViewDto>;
  /** Saves the answers and asks for the proposal (in PROPOSAL, regenerates it; optional `notes` ≤ 2000 chars say what to change and are kept for later regenerations). Returns at once with status WORKING. */
  'inception:answer': (
    projectId: string,
    answers: InceptionAnswerDto[],
    notes?: string,
    options?: { exploreUi?: boolean; corrections?: RepositoryCorrectionDto[] },
  ) => Promise<InceptionViewDto>;
  /** Adds a prototype (HTML) the user made elsewhere as one more design direction; only while choosing a direction. Answers at once. */
  'inception:import_prototype': (projectId: string, input: { name: string; html: string }) => Promise<InceptionViewDto>;
  /** Adds a finished design made elsewhere: an image (base64; a model describes it) or React code (converted to an HTML prototype). Returns at once with status WORKING. */
  'inception:import_design': (
    projectId: string,
    input: { name: string; kind: 'IMAGE' | 'REACT'; content: string },
  ) => Promise<InceptionViewDto>;
  /** Regenerates one design direction with the user's change requests; returns at once with status WORKING. */
  'inception:revise_ui': (projectId: string, optionId: string, notes: string) => Promise<InceptionViewDto>;
  /** From the proposal, back to the design directions (generated now when the design was never asked for); the pending proposal is rejected. */
  'inception:reopen_design': (projectId: string) => Promise<InceptionViewDto>;
  /** Approves a design direction and asks for the proposal built on it (`null` skips the design). Returns at once with status WORKING. */
  'inception:choose_ui': (projectId: string, optionId: string | null) => Promise<InceptionViewDto>;
  /** Applies the proposal's ChangeSet (needs a primary repository). */
  'inception:approve': (projectId: string) => Promise<InceptionViewDto>;
  /** Forgets questions, answers and the pending proposal, and stops a running engine call; refused once applied. */
  'inception:restart': (projectId: string) => Promise<InceptionViewDto>;
}
export interface WorkspaceIpcQueries {
  'project:list': () => Promise<ProjectSummaryDto[]>;
  'graph:get_view': (projectId: string, filter?: GraphFilterDto) => Promise<GraphViewDto>;
  'entity:get_inspector_details': (entityId: string) => Promise<EntityInspectorDto>;
  'repository:get_path': (projectId: string) => Promise<string | null>;
  'artifact:list': (projectId: string) => Promise<ArtifactDocumentDto[]>;
  'artifact:read': (documentId: string) => Promise<ArtifactDocumentViewDto>;
  'changeset:list': (projectId: string) => Promise<ChangeSetDto[]>;
  'context:get_snapshot': (snapshotId: string) => Promise<ContextSnapshotDto>;
  'context:preview_package': (input: PreviewContextInput) => Promise<ContextPackageDto>;
  'agent:list_profiles': (projectId: string) => Promise<AgentProfileDto[]>;
  'execution:list': (projectId: string) => Promise<AgentExecutionDto[]>;
  'execution:list_events': (executionId: string) => Promise<AgentEventRecordDto[]>;
  'execution:get_detail': (executionId: string) => Promise<ExecutionDetailDto>;
  'policy:get': (projectId: string) => Promise<ExecutionPolicyDto>;
  'environment:get': (projectId: string) => Promise<ProjectEnvironmentDto>;
  'pilot:get': (projectId: string, featureId: string) => Promise<FeaturePilotDto>;
  'provider:get_auth': (
    projectId: string,
  ) => Promise<{ authMode: 'subscription' | 'api_key'; apiKeyAvailable: boolean }>;
  'graph:context_flow': (projectId: string, workItemId: string) => Promise<ContextFlowDto>;
  'metrics:feature_report': (projectId: string, featureId: string) => Promise<FeatureReportDto>;
  'activity:list': (projectId: string, limit?: number) => Promise<ActivitySummaryDto>;
  'inception:get': (projectId: string) => Promise<InceptionViewDto>;
  /** The HTML of a design direction's prototype (kept out of `inception:get`, which is polled). */
  'inception:get_ui_prototype': (projectId: string, optionId: string) => Promise<string>;
  /** Brownfield preview: manifests, structure and style files the assistant would read from the project's repository (paths and sizes, no contents; .gitignore respected, no symlinks or secrets, ≤ 48 KB). */
  'repository:scan': (projectId: string) => Promise<RepositoryScanSummaryDto>;
}
export interface WorkspaceIpcEvents {
  'graph:revision_updated': { projectId: string; revision: number };
  'artifact:sync_status_changed': ArtifactSyncStatusChangedDto;
  'execution:status_changed': { executionId: string; workItemId: string; status: AgentExecutionDto['status'] };
  'execution:event_received': { executionId: string; event: AgentEventDto };
  'pilot:updated': { projectId: string; featureId: string; status: string | null };
  'inception:updated': { projectId: string; stage: InceptionStage; status: InceptionStatus };
}
export type IpcCommandChannel = keyof WorkspaceIpcCommands;
export type IpcQueryChannel = keyof WorkspaceIpcQueries;
export type IpcEventChannel = keyof WorkspaceIpcEvents;

export interface WorkspaceIpcClient {
  commands: {
    createProject(input: CreateProjectInput): Promise<ProjectSummaryDto>;
    openProject(projectId: string): Promise<WorkspaceLoadedStateDto>;
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
    updateExecutionPolicy(projectId: string, policy: ExecutionPolicyDto): Promise<ExecutionPolicyDto>;
    /** Plan S2: approve packages outside the stack profile. Optional so existing fakes stay valid; the Tauri client implements it. */
    approveDependencies?(projectId: string, packages: string[]): Promise<ProjectEnvironmentDto>;
    /** Plan S4: turn the bundled skills on or off for the project's interface tasks. Optional so existing fakes stay valid. */
    setProjectSkills?(projectId: string, enabled: boolean): Promise<ProjectEnvironmentDto>;
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
    /** Optional so existing fakes stay valid; the Tauri client implements it. */
    integrateFeature?(projectId: string, featureId: string): Promise<FeatureIntegrationResultDto>;
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
    /** Plan S2: stack profile and approved packages. Optional so existing fakes stay valid. */
    getProjectEnvironment?(projectId: string): Promise<ProjectEnvironmentDto>;
    getFeaturePilot(projectId: string, featureId: string): Promise<FeaturePilotDto>;
    /** How the engine authenticates for the project (works without features, unlike getFeaturePilot). Optional so older client fakes stay valid. */
    getProviderAuth?(projectId: string): Promise<{ authMode: 'subscription' | 'api_key'; apiKeyAvailable: boolean }>;
    getContextFlow(projectId: string, workItemId: string): Promise<ContextFlowDto>;
    getFeatureReport(projectId: string, featureId: string): Promise<FeatureReportDto>;
    getActivity(projectId: string, limit?: number): Promise<ActivitySummaryDto>;
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
  };
}
