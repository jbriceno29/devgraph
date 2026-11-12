import type { ChangeSetDraft } from './change-set-planning-port.js';
import type { InceptionAnswerDto, InceptionQuestionDto, InceptionReferenceDto, InceptionReferenceTranslationDto, InceptionUiOptionDto, ReferenceKind } from '../../shared/contracts/inception-view.js';
import type { RepositoryCorrectionDto, RepositoryInferenceDto, RepositoryScanDto } from '../../shared/contracts/repository-scan.js';

/** Brownfield mode: what was read from a repository that already has code, what the assistant inferred from it and what the user corrected. */
export interface InceptionRepositoryState { scan: RepositoryScanDto; inferences: RepositoryInferenceDto[]; corrections: RepositoryCorrectionDto[] }

/** Tokens and cost of one engine call (null fields when the engine does not report them). */
export interface InceptionEngineUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number | null; model: string | null }
export interface InceptionProjectInput {
  name: string; description: string | null; brief: string; /** PROJECT_ROOT id: parent of modules and target of the ADR's AFFECTS edge. */ rootId: string;
  /** The references already translated to text, as data for the prompts (the engine never sees the files). */
  references?: Array<{ kind: ReferenceKind; name: string; note: string; translation: InceptionReferenceTranslationDto }>;
  /** The visual direction the user approved (data for the proposal). `prototypeHtml` only for an imported one, whose details nobody wrote down. */
  direction?: { title: string; summary: string; navigation: string; screens: string[]; designSystemNotes: string[]; source: 'GENERATED' | 'IMPORTED'; prototypeHtml?: string };
  /** The project's repository already has code: the scan (data for every prompt), the inferences already made and the user's corrections. */
  repository?: InceptionRepositoryState;
}

/** One visual direction as the engine writes it: details plus a self-contained interactive HTML prototype. */
export interface UiOptionDraft { title: string; summary: string; navigation: string; screens: string[]; designSystemNotes: string[]; prototypeHtml: string }

/** A stored reference: what the view shows, plus the file inside the project's references folder. */
export interface InceptionReference extends InceptionReferenceDto { file: string }

/** A stored visual direction: what the view shows plus the prototype's HTML. */
export interface InceptionUiOption extends InceptionUiOptionDto {
  prototypeHtml: string;
  /** For an IMAGE direction: the stored picture (in the references folder) and its media type; its page is built on request, so the record stays small. */
  imageFile?: string; imageMime?: string;
}
export interface InceptionUiState { wanted: boolean; options: InceptionUiOption[]; selectedOptionId: string | null }
export const EMPTY_UI_STATE: InceptionUiState = { wanted: false, options: [], selectedOptionId: null };

/**
 * Turns reference files (images, PDFs, documents) into structured text with a model of its own, separate from the inception engine.
 * It reads only the files it is given. Results are per reference: one that could not be read comes back with `error` and no translation.
 */
export interface ReferenceTranslatorPort {
  translate(input: { files: Array<{ id: string; kind: ReferenceKind | 'DESIGN'; note: string; mimeType: string; /** Absolute path of the stored copy. */ path: string }>; model?: string; signal?: AbortSignal }): Promise<{ results: Array<{ id: string; translation: InceptionReferenceTranslationDto | null; error: string | null }>; usage: InceptionEngineUsage | null }>;
}

/** Where the attached files live (inside the project's workspace folder). `file` is always `ref-<n>.<extension>`. */
export interface InceptionReferenceFilesPort {
  save(projectId: string, file: string, content: Buffer): void;
  pathOf(projectId: string, file: string): string;
  read(projectId: string, file: string): Buffer;
  /** Removes every stored reference of the project (restart, or replacing them). */
  deleteAll(projectId: string): void;
}

/**
 * The engine behind each inception gate. `signal` aborts the call (restart or app shutdown): the engine stops its process. Every call is independent (no engine session): the prompt is rebuilt from
 * the brief and the stored answers, so one gate can run on Claude and the next on another engine.
 */
export interface InceptionEnginePort {
  /** Up to 5 short questions about goal and scope, with suggested options. */
  askGoals(input: { project: InceptionProjectInput; model?: string; signal?: AbortSignal }): Promise<{ questions: InceptionQuestionDto[]; assumptions: string[]; /** Brownfield only: stack, design system, structure and testing inferred from the scan, each with evidence paths (the service keeps only evidence that exists). */ inferences?: unknown[]; usage: InceptionEngineUsage | null }>;
  /** One proposal: profile, stack ADR with alternatives, vision, requirements and the initial plan with «Fundación». */
  propose(input: { project: InceptionProjectInput; questions: InceptionQuestionDto[]; answers: InceptionAnswerDto[]; model?: string; /** The user's change requests about earlier proposals (data, never instructions). */ notes?: string[]; signal?: AbortSignal }): Promise<{ draft: ChangeSetDraft; assumptions: string[]; usage: InceptionEngineUsage | null }>;
  /**
   * Two or three contrasting visual directions, each with a self-contained interactive HTML prototype (no external resources). With `revise`,
   * it returns exactly that direction updated with the user's change requests (data, never instructions).
   */
  exploreUi(input: { project: InceptionProjectInput; questions: InceptionQuestionDto[]; answers: InceptionAnswerDto[]; model?: string; revise?: { option: UiOptionDraft; notes: string[] }; signal?: AbortSignal }): Promise<{ options: UiOptionDraft[]; assumptions: string[]; usage: InceptionEngineUsage | null }>;
}

export type InceptionRecordStage = 'ASK_GOALS' | 'EXPLORE_UI' | 'PROPOSAL' | 'APPLIED';
export type InceptionRecordStatus = 'WORKING' | 'WAITING_USER' | 'FAILED' | 'DONE';
export interface InceptionRecord {
  projectId: string; stage: InceptionRecordStage; status: InceptionRecordStatus; brief: string;
  questions: InceptionQuestionDto[]; answers: InceptionAnswerDto[]; assumptions: string[];
  changeSetId: string | null; model: string | null; usage: InceptionEngineUsage[]; error: string | null;
  /** Change requests for the proposal, oldest first. */
  notes: string[];
  /** The scaffold task's graph id, resolved when the proposal is applied. */
  scaffoldTaskId: string | null;
  /** Attached references, stored in order (`ref-1`, `ref-2`…). */
  references: InceptionReference[];
  /** Visual exploration (optional step before the proposal). */
  ui: InceptionUiState;
  /** Brownfield mode: null when the repository had no code (or none was configured) when the inception started. */
  repository: InceptionRepositoryState | null;
  createdAt: string; updatedAt: string;
}
export interface InceptionRepositoryPort {
  find(projectId: string): InceptionRecord | null;
  save(record: InceptionRecord): void;
  /** Forgets the inception state (restart). Never touches the graph or the repository. */
  delete(projectId: string): void;
}
