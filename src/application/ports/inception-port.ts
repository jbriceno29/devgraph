import type { ChangeSetDraft } from './change-set-planning-port.js';
import type { InceptionAnswerDto, InceptionQuestionDto } from '../../shared/contracts/inception-view.js';

/** Tokens and cost of one engine call (null fields when the engine does not report them). */
export interface InceptionEngineUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number | null; model: string | null }
export interface InceptionProjectInput { name: string; description: string | null; brief: string; /** PROJECT_ROOT id: parent of modules and target of the ADR's AFFECTS edge. */ rootId: string }

/**
 * The engine behind each inception gate. `signal` aborts the call (restart or app shutdown): the engine stops its process. Every call is independent (no engine session): the prompt is rebuilt from
 * the brief and the stored answers, so one gate can run on Claude and the next on another engine.
 */
export interface InceptionEnginePort {
  /** Up to 5 short questions about goal and scope, with suggested options. */
  askGoals(input: { project: InceptionProjectInput; model?: string; signal?: AbortSignal }): Promise<{ questions: InceptionQuestionDto[]; assumptions: string[]; usage: InceptionEngineUsage | null }>;
  /** One proposal: profile, stack ADR with alternatives, vision, requirements and the initial plan with «Fundación». */
  propose(input: { project: InceptionProjectInput; questions: InceptionQuestionDto[]; answers: InceptionAnswerDto[]; model?: string; /** The user's change requests about earlier proposals (data, never instructions). */ notes?: string[]; signal?: AbortSignal }): Promise<{ draft: ChangeSetDraft; assumptions: string[]; usage: InceptionEngineUsage | null }>;
}

export type InceptionRecordStage = 'ASK_GOALS' | 'PROPOSAL' | 'APPLIED';
export type InceptionRecordStatus = 'WORKING' | 'WAITING_USER' | 'FAILED' | 'DONE';
export interface InceptionRecord {
  projectId: string; stage: InceptionRecordStage; status: InceptionRecordStatus; brief: string;
  questions: InceptionQuestionDto[]; answers: InceptionAnswerDto[]; assumptions: string[];
  changeSetId: string | null; model: string | null; usage: InceptionEngineUsage[]; error: string | null;
  /** Change requests for the proposal, oldest first. */
  notes: string[];
  /** The scaffold task's graph id, resolved when the proposal is applied. */
  scaffoldTaskId: string | null;
  createdAt: string; updatedAt: string;
}
export interface InceptionRepositoryPort {
  find(projectId: string): InceptionRecord | null;
  save(record: InceptionRecord): void;
  /** Forgets the inception state (restart). Never touches the graph or the repository. */
  delete(projectId: string): void;
}
