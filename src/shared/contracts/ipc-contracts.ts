import type { ContextFlowDto, GraphEdgeType, GraphNodeView, GraphEdgeView, KnowledgeEntityType } from './graph-view.js';
import type {
  ArtifactDocumentDto,
  ArtifactDocumentViewDto,
  ArtifactSyncStatusChangedDto,
  CreateArtifactDocumentInput,
} from './artifact-view.js';
import type { ContextPackageDto, ContextSnapshotDto, PreviewContextInput } from './context-view.js';
import type { ActivitySummaryDto } from './activity-view.js';
import type { AgentAccessProposalDto, RepositoryCorrectionDto, RepositoryScanSummaryDto } from './repository-scan.js';
import type { EntityInspectorDto } from './inspector-view.js';
import type { IpcExtensionChannels, IpcExtensionCommands } from './ipc-extensions.js';
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
  FeatureIntegrationStateDto,
  ProjectEnvironmentDto,
  CommandRunDto,
  ProjectScriptsDto,
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
  /**
   * Where the project's code lives, set up together with the project: `NEW_FOLDER` creates the folder (missing or empty)
   * with `git init` and a first commit; `EXISTING_REPOSITORY` connects a folder that already holds a Git repository.
   * If this step fails the project is not created. Without it, the repository is connected later (as before).
   */
  location?: ProjectLocationInput;
}
export interface ProjectLocationInput {
  mode: 'NEW_FOLDER' | 'EXISTING_REPOSITORY';
  path: string;
}
/** The folder proposed the first time: a usual place that already holds repositories, or ~/Documents/repos. */
export interface ProjectsFolderSuggestionDto {
  path: string;
  exists: boolean;
  /** Direct subfolders with `.git` (why it was proposed). */
  repositoryCount: number;
}
/** App-wide settings (not per project). `projectsFolder` null: the user has not chosen it yet (first run). */
export interface AppSettingsDto {
  projectsFolder: string | null;
  suggestion: ProjectsFolderSuggestionDto;
}
/** What is at a path (normalized, absolute), checked before creating a project there. */
export interface FolderInspectionDto {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  empty: boolean;
  isGitRepository: boolean;
  parentExists: boolean;
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
export type { EntityInspectorDto, RelationshipViewDto } from './inspector-view.js';
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
export interface WorkspaceIpcCommands extends IpcExtensionChannels {
  'project:create': (input: CreateProjectInput) => Promise<ProjectSummaryDto>;
  'project:open': (projectId: string) => Promise<WorkspaceLoadedStateDto>;
  /** Saves the folder where new projects are created (created if missing; must be writable). */
  'settings:set_projects_folder': (path: string) => Promise<AppSettingsDto>;
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
  'decision:set_status': (
    projectId: string,
    decisionId: string,
    status: string,
  ) => Promise<{ status: string; revision: number }>;
  'policy:update': (projectId: string, policy: ExecutionPolicyDto) => Promise<ExecutionPolicyDto>;
  'environment:approve_dependencies': (projectId: string, packages: string[]) => Promise<ProjectEnvironmentDto>;
  'environment:set_skills': (projectId: string, enabled: boolean) => Promise<ProjectEnvironmentDto>;
  'commands:start': (projectId: string, input: { ref: string; script: string }) => Promise<CommandRunDto>;
  'commands:stop': (projectId: string, runId: string) => Promise<CommandRunDto>;
  'pilot:set_autonomy': (
    projectId: string,
    featureId: string,
    input: SetFeatureAutonomyInput,
  ) => Promise<FeatureAutonomyDto>;
  'pilot:start': (projectId: string, featureId: string, input: { acknowledgeCost: boolean }) => Promise<PilotRunDto>;
  'pilot:stop': (projectId: string, featureId: string) => Promise<PilotRunDto | null>;
  'pilot:resume': (projectId: string, featureId: string) => Promise<PilotRunDto>;
  'metrics:export_report': (projectId: string, featureId: string) => Promise<{ path: string }>;
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
  'settings:get': () => Promise<AppSettingsDto>;
  /** Read-only: whether an absolute path is missing, an empty folder, a Git repository or a folder with files. */
  'folder:inspect': (path: string) => Promise<FolderInspectionDto>;
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
  'policy:propose_from_repository': (projectId: string) => Promise<AgentAccessProposalDto>;
  'environment:get': (projectId: string) => Promise<ProjectEnvironmentDto>;
  'commands:refs': (projectId: string) => Promise<{ refs: string[]; current: string | null }>;
  'commands:scripts': (projectId: string, ref: string) => Promise<ProjectScriptsDto>;
  'commands:list': (projectId: string) => Promise<CommandRunDto[]>;
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
  'command:updated': { projectId: string; run: CommandRunDto };
  'command:output': { projectId: string; runId: string; chunk: string };
  'inception:updated': { projectId: string; stage: InceptionStage; status: InceptionStatus };
}
export type IpcCommandChannel = keyof WorkspaceIpcCommands;
export type IpcQueryChannel = keyof WorkspaceIpcQueries;
export type IpcEventChannel = keyof WorkspaceIpcEvents;

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
