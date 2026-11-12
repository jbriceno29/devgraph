import type { GraphEdgeType, GraphNodeView, GraphEdgeView, KnowledgeEntityType } from './graph-view.js';
import type { InceptionReferenceDto } from './inception-view.js';

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
