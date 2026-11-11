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
  updatedAt: string | null;
}
export interface StartInceptionInput { brief: string; /** Model alias; defaults to the provider's planning model (opus). */ model?: string }
/** Activity inbox summary of the inception (see ActivitySummaryDto.inception). */
export interface InceptionActivityDto { stage: InceptionStage; status: InceptionStatus; title: string; detail: string; needsAttention: boolean; changeSetId: string | null; at: string }
export interface InitializeRepositoryResultDto { projectId: string; localPath: string; initialCommit: string; files: string[] }

/** Inception channels of the IPC client (optional group, so existing client fakes stay valid). */
export interface InceptionIpcClient {
  get(projectId: string): Promise<InceptionViewDto>;
  start(projectId: string, input: StartInceptionInput): Promise<InceptionViewDto>;
  answer(projectId: string, answers: InceptionAnswerDto[]): Promise<InceptionViewDto>;
  approve(projectId: string): Promise<InceptionViewDto>;
  restart(projectId: string): Promise<InceptionViewDto>;
  initializeRepository(projectId: string, absolutePath: string): Promise<InitializeRepositoryResultDto>;
  onUpdated(listener: (event: { projectId: string; stage: InceptionStage; status: InceptionStatus }) => void): () => void;
}
