import type { ArtifactManagementService } from '../modules/documents/application/artifact-management-service.js';
import type { AtomicMarkdownFileStore } from '../modules/documents/infrastructure/atomic-markdown-file-store.js';
import type { GitDocumentCommitter } from '../modules/documents/infrastructure/git-document-committer.js';
import type { ChangeSetPlanningService } from '../modules/planning/application/change-set-planning-service.js';
import type { PlanningReferencesService } from '../modules/planning/application/planning-references.js';
import type { ChangeSetPlannerPort } from '../modules/planning/application/ports/change-set-planning-port.js';
import type { ProjectInceptionService } from '../modules/inception/application/project-inception-service.js';
import type {
  InceptionEnginePort,
  ReferenceTranslatorPort,
} from '../modules/inception/application/ports/inception-port.js';
import type { ContextEngine } from '../modules/context/application/context-engine.js';
import type { AgentOrchestrator } from '../modules/execution/application/agent-orchestrator.js';
import type { AgentAdapterPort } from '../modules/execution/application/ports/agent-adapter-port.js';
import type {
  SkillProvisionPort,
  WorkspaceEnvironmentPort,
} from '../modules/execution/application/ports/agent-execution-port.js';
import type { ChangeReviewVerdict } from '../modules/execution/application/ports/change-review-port.js';
import type { ReviewInput } from '../modules/execution/infrastructure/change-review-contract.js';
import type { FeaturePilot } from '../modules/autopilot/application/feature-pilot.js';
import type { FeatureConflictUseCases } from '../modules/execution/ipc.js';
import type { RepositoryScannerPort } from '../modules/projects/application/ports/repository-scan-port.js';
import type { AppSettingsStore } from '../modules/projects/infrastructure/project-folders.js';
import type { ProjectCommands } from '../modules/environment/infrastructure/project-commands.js';
import type { ProjectEnvironmentDto } from '../shared/contracts/agent-view.js';
import type { ProjectDocsDto } from '../shared/contracts/project-docs.js';
import type { ProjectWorkspaceStore } from './project-workspace-store.js';
import { baseServices } from './compose/base.js';
import { documentServices } from './compose/documents.js';
import { planningServices } from './compose/planning.js';
import { inceptionServices } from './compose/inception.js';
import { documentationServices } from './compose/documentation.js';
import { environmentServices } from './compose/environment.js';
import { verificationBaselineServices } from './compose/verification-baseline.js';
import { executionServices } from './compose/execution.js';
import { autopilotServices } from './compose/autopilot.js';
import { featureConflictServices } from './compose/feature-conflicts.js';

export type WorkspaceEventEmitter = (channel: string, payload: unknown) => void;

/** What tests (and a future engine) can replace; everything else is the real adapter. */
export interface CoreDependencies {
  agentAdapter?: AgentAdapterPort;
  inceptionEngine?: InceptionEnginePort;
  referenceTranslator?: ReferenceTranslatorPort;
  repositoryScanner?: RepositoryScannerPort;
  /** Tests: the ChangeSet planner (otherwise the wired engine's). */
  changeSetPlanner?: ChangeSetPlannerPort;
  /** Tests: what installs the dependencies (otherwise npm). */
  environmentInstaller?: Omit<WorkspaceEnvironmentPort, 'forProject'>;
  /** Tests: the executables project commands run (otherwise npm and pnpm from PATH). */
  commandExecutables?: { npm?: string; pnpm?: string };
  /** Tests: where the bundled skills are (otherwise next to the core). */
  skillsDirectory?: string;
  /** Tests: the user's home folder (where the projects folder is looked for); otherwise os.homedir(). */
  homeDirectory?: string;
  /** Tests: the review engine (otherwise Claude), given the assembled evidence. */
  changeReviewer?: { review(input: ReviewInput, model: string): Promise<ChangeReviewVerdict> };
}

/** The engine connection of a project's developer profile (model and auth mode for every engine call). */
export interface EngineConnection {
  authMode: 'subscription' | 'api_key';
  planningModel: string | null;
  availableModels: string[];
}

/**
 * The core's services, built on demand per project. Only the bootstrap creates adapters (CLAUDE.md, rule 5); the IPC
 * handlers of each module receive the part of this they use.
 */
export interface Container {
  workspaceRoot: string;
  dependencies: CoreDependencies;
  emit: WorkspaceEventEmitter;
  store: ProjectWorkspaceStore;
  settings: AppSettingsStore;
  files: AtomicMarkdownFileStore;
  documentCommitter: GitDocumentCommitter;
  agentAdapter: AgentAdapterPort;
  scanner: RepositoryScannerPort;
  connection(projectId: string): EngineConnection;
  repositoryPath(projectId: string): string | null;
  repositoryOf(projectId: string): string;
  /** The project's base branch as configured (plan GIT); null without a repository. */
  baseBranch(projectId: string): string | null;
  engineDirectory(projectId: string): string;
  management(projectId: string): ArtifactManagementService;
  managementForDocument(documentId: string): ArtifactManagementService;
  recoverDocuments(projectId: string): Promise<void>;
  startWatcher(projectId: string): Promise<void>;
  planning(projectId: string): ChangeSetPlanningService;
  planningForChangeSet(changeSetId: string): ChangeSetPlanningService;
  planningReferences: PlanningReferencesService;
  translator(projectId: string): ReferenceTranslatorPort;
  inception(projectId: string): ProjectInceptionService;
  inceptionIfStarted(projectId: string): ProjectInceptionService | undefined;
  context(projectId: string): ContextEngine;
  contextForSnapshot(snapshotId: string): ContextEngine;
  currentRevision(projectId: string): number;
  environment(projectId: string): WorkspaceEnvironmentPort;
  skills(projectId: string): SkillProvisionPort;
  environmentView(projectId: string): Promise<ProjectEnvironmentDto>;
  setSkills(projectId: string, enabled: unknown): Promise<ProjectEnvironmentDto>;
  approveDependencies(projectId: string, packages: unknown): Promise<ProjectEnvironmentDto>;
  docsView(projectId: string): ProjectDocsDto;
  baseline: ReturnType<typeof verificationBaselineServices>['baseline'];
  docDomains(projectId: string): string[];
  setDocs(projectId: string, input: unknown): ProjectDocsDto;
  commands: ProjectCommands;
  execution(projectId: string): AgentOrchestrator;
  executionFor(executionId: string): AgentOrchestrator;
  pilot(projectId: string): FeaturePilot;
  featureConflicts: FeatureConflictUseCases;
  featureReport(projectId: string, featureId: string): { report: unknown; markdown: string };
  close(): void;
}

export function createContainer(
  workspaceRoot: string,
  emit: WorkspaceEventEmitter,
  dependencies: CoreDependencies,
): Container {
  const c = baseServices(workspaceRoot, emit, dependencies) as Container;
  const parts = [
    documentServices,
    planningServices,
    inceptionServices,
    environmentServices,
    documentationServices,
    executionServices,
    featureConflictServices,
    verificationBaselineServices,
  ];
  const closers: Array<() => void> = [];
  for (const part of [...parts, autopilotServices]) {
    const { close, ...services } = part(c);
    Object.assign(c, services);
    closers.push(close);
  }
  c.close = () => {
    for (const close of closers.reverse()) close();
    c.store.closeAll();
  };
  return c;
}
