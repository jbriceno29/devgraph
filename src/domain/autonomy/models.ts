/** How much a feature runs on its own (Stage 3). */
export type AutonomyLevel = 'MANUAL' | 'AUTO_ACCEPT' | 'PILOT';
export interface FeatureAutonomy {
  featureId: string;
  projectId: string;
  level: AutonomyLevel;
  /** Model alias for normal runs; null uses the provider's execution default. */
  executionModel: string | null;
  /** Model alias for the last attempt after failures; null keeps the execution model. */
  escalationModel: string | null;
  /** Attempts per task before the autopilot asks the user. */
  maxAttempts: number;
  /** Fraction (0-1) of the usage window at which the autopilot pauses. */
  usagePauseThreshold: number;
}
export const DEFAULT_AUTONOMY: Omit<FeatureAutonomy, 'featureId' | 'projectId'> = { level: 'MANUAL', executionModel: null, escalationModel: null, maxAttempts: 3, usagePauseThreshold: 0.85 };

export type PilotStatus = 'RUNNING' | 'PAUSED' | 'WAITING_USER' | 'COMPLETED' | 'STOPPED' | 'FAILED';
export const ACTIVE_PILOT_STATUSES: ReadonlySet<PilotStatus> = new Set(['RUNNING', 'PAUSED']);
export interface PilotRun { id: string; projectId: string; featureId: string; status: PilotStatus; reason: string | null; startedAt: string; endedAt: string | null }
export type PilotEventKind = 'STARTED' | 'TASK_STARTED' | 'TASK_ACCEPTED' | 'AUTO_ACCEPTED' | 'RETRY' | 'ESCALATED' | 'PAUSED' | 'RESUMED' | 'WAITING_USER' | 'COMPLETED' | 'STOPPED' | 'FAILED'
  /** The agent's plan proposal was applied to the graph (PLAN_CHANGED) or awaits the user / was invalid (PLAN_PROPOSAL). */
  | 'PLAN_CHANGED' | 'PLAN_PROPOSAL';
export interface PilotEvent { id: string; pilotRunId: string; sequenceNo: number; kind: PilotEventKind; message: string; workItemId: string | null; executionId: string | null; createdAt: string }
