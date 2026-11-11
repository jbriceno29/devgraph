/**
 * Project inception («asistente de proyecto»): two gates. ASK_GOALS (up to 5 questions about goal and scope) and
 * PROPOSAL (one ChangeSet with profile, stack ADR, vision, requirements and the initial plan with «Fundación»), then APPLIED.
 * Every engine call is independent: questions, answers and the proposal live in the workspace (table project_inception).
 */
export type InceptionStage = 'NOT_STARTED' | 'ASK_GOALS' | 'PROPOSAL' | 'APPLIED';
/** WORKING: an engine call is running. WAITING_USER: answer (ASK_GOALS) or approve (PROPOSAL). FAILED: see `error`, retry. */
export type InceptionStatus = 'IDLE' | 'WORKING' | 'WAITING_USER' | 'FAILED' | 'DONE';
/** What the UI should offer now. */
export type InceptionNextAction = 'START' | 'WAIT' | 'ANSWER' | 'RETRY_QUESTIONS' | 'RETRY_PROPOSAL' | 'SET_UP_REPOSITORY' | 'APPROVE' | 'REVISE_PROPOSAL' | 'DONE';

export interface InceptionQuestionDto { id: string; text: string; /** Suggested answers (may be empty: free text). */ options: string[]; /** Suggested default, one of `options` or null. */ default: string | null; why: string }
export interface InceptionAnswerDto { questionId: string; /** Chosen option or free text; empty means «decide tú» (the default or the engine's choice). */ answer: string }
export interface InceptionUsageDto { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number | null }
export interface InceptionProfileDto { description: string | null; objectives: string[]; outOfScope: string[]; techStack: Record<string, string>; rules: string[]; verificationCommands: string[] }
export interface InceptionFeatureDto { tempId: string; title: string; isFoundation: boolean; dependsOn: string[]; tasks: Array<{ tempId: string; title: string; initialStatus: 'READY' | 'BLOCKED' }> }
export interface InceptionProposalDto {
  changeSetId: string; title: string; rationale: string;
  /** ChangeSet status: VALIDATED can be approved; PENDING_APPROVAL with `issues` must be revised; APPLIED once approved. */
  status: 'PENDING_APPROVAL' | 'VALIDATED' | 'CONFLICTED' | 'APPLIED' | 'REJECTED';
  issues: string[];
  /** Why it needs the user (PROJECT_FOUNDATION always asks). */
  decisionReasons: string[];
  profile: InceptionProfileDto | null;
  decision: { title: string; alternativesMd: string; decisionMd: string; consequencesMd: string } | null;
  documents: Array<{ title: string; relativePath: string }>;
  requirements: string[];
  features: InceptionFeatureDto[];
  /** The «Fundación» scaffold task (READY after approval). */
  scaffoldTaskTitle: string | null;
}
export interface InceptionViewDto {
  projectId: string; stage: InceptionStage; status: InceptionStatus; nextAction: InceptionNextAction;
  brief: string; questions: InceptionQuestionDto[]; answers: InceptionAnswerDto[];
  /** Assumptions the engine made: shown, not hidden. */
  assumptions: string[];
  proposal: InceptionProposalDto | null;
  error: string | null; model: string | null;
  /** Primary repository; approving needs one (repository:configure or repository:initialize). */
  repositoryPath: string | null;
  usage: InceptionUsageDto;
  /** Change requests the user gave when asking for another proposal (oldest first); every regeneration applies all of them. */
  notes: string[];
  /** Graph id of the «Fundación» scaffold task once the proposal is applied (null before, or when it could not be resolved). */
  scaffoldTaskId: string | null;
  /** The attached references and what the translator understood from each (the files themselves never leave the workspace). */
  references: InceptionReferenceDto[];
  updatedAt: string | null;
}
/** Limits of `inception:answer` notes (one change request per regeneration). */
export const MAX_INCEPTION_NOTE = 2000;
/**
 * Reference material the user attaches to the brief (screenshots, sketches, an HTML prototype, a PDF, a document). The assistant never
 * sees the files: a separate model call translates each one into text, and everything after works with that text. The kind says how to read it:
 * VISUAL = how the app should look (never a list of requirements), FUNCTIONAL = behaviour and flows wanted, CONCEPTUAL = inspiration only.
 */
export type ReferenceKind = 'VISUAL' | 'FUNCTIONAL' | 'CONCEPTUAL';
export const REFERENCE_KINDS: readonly ReferenceKind[] = ['VISUAL', 'FUNCTIONAL', 'CONCEPTUAL'];
export const MAX_REFERENCES = 5;
/** Per file and in total (decoded bytes). */
export const MAX_REFERENCE_BYTES = 3 * 1024 * 1024;
export const MAX_REFERENCES_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCE_NOTE = 500;
/** Accepted extensions and their media type. Text-like files (md, txt, html) are read as text, never run. */
export const REFERENCE_FILE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', html: 'text/html' };
export interface InceptionReferenceInput { name: string; kind: ReferenceKind; /** What to keep or avoid, in the user's words (optional). */ note?: string; /** File content, base64. */ dataBase64: string }
/** What a translator model understood from a file. Only the fields of the reference's kind are filled; `openQuestions` is for any kind. */
export interface InceptionReferenceTranslationDto { summary: string; palette: string[]; typography: string; layout: string; screens: string[]; actions: string[]; flows: string[]; states: string[]; ideas: string[]; openQuestions: string[] }
export type InceptionReferenceStatus = 'PENDING' | 'TRANSLATED' | 'FAILED';
export interface InceptionReferenceDto { id: string; name: string; kind: ReferenceKind; note: string; mimeType: string; bytes: number; status: InceptionReferenceStatus; error: string | null; translation: InceptionReferenceTranslationDto | null }
export interface StartInceptionInput { brief: string; /** Model alias; defaults to the provider's planning model (opus). */ model?: string; /** Up to MAX_REFERENCES files. On a retry after a failure, omit them: the ones already stored are reused. */ references?: InceptionReferenceInput[] }
/** Activity inbox summary of the inception (see ActivitySummaryDto.inception). */
export interface InceptionActivityDto { stage: InceptionStage; status: InceptionStatus; title: string; detail: string; needsAttention: boolean; changeSetId: string | null; at: string }
export interface InitializeRepositoryResultDto { projectId: string; localPath: string; initialCommit: string; files: string[] }

/** Inception channels of the IPC client (optional group, so existing client fakes stay valid). */
export interface InceptionIpcClient {
  get(projectId: string): Promise<InceptionViewDto>;
  start(projectId: string, input: StartInceptionInput): Promise<InceptionViewDto>;
  /** `notes`: optional free text with what to change; only while reviewing a proposal (it regenerates it keeping the answers). */
  answer(projectId: string, answers: InceptionAnswerDto[], notes?: string): Promise<InceptionViewDto>;
  approve(projectId: string): Promise<InceptionViewDto>;
  restart(projectId: string): Promise<InceptionViewDto>;
  initializeRepository(projectId: string, absolutePath: string): Promise<InitializeRepositoryResultDto>;
  onUpdated(listener: (event: { projectId: string; stage: InceptionStage; status: InceptionStatus }) => void): () => void;
}
