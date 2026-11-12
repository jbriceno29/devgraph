/** Activity inbox of a project: what is ready, running, in review, done or waiting on the user. Derived, no AI involved. */
export type ActivityKind =
  | 'TASK_READY'
  | 'TASK_RUNNING'
  | 'TASK_IN_REVIEW'
  | 'TASK_DONE'
  | 'TASK_FAILED'
  | 'PILOT_WAITING'
  | 'PILOT_PAUSED'
  | 'PILOT_COMPLETED'
  | 'PLAN_PROPOSAL'
  | 'PLAN_CHANGED'
  | 'APPROVAL_PENDING';
export type ActivityTarget = 'agents' | 'planning' | 'graph';
export interface ActivityItemDto {
  id: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  needsAttention: boolean;
  workItemId: string | null;
  executionId: string | null;
  featureId: string | null;
  changeSetId: string | null;
  target: ActivityTarget;
}
export interface ActivitySummaryDto {
  items: ActivityItemDto[];
  running: Array<{ workItemKey: string; title: string }>;
  attentionCount: number;
  /** Project inception state when it is under way («te falta responder / aprobar»). Counted in attentionCount when it needs the user. A proposal waiting for approval also appears in items as PLAN_PROPOSAL. */
  inception?: import('./inception-view.js').InceptionActivityDto | null;
  /** Features with an integration branch and whether the app integrated it into its base branch (`integratedAt`); cheap, no git. */
  integrations?: Array<{
    featureId: string;
    branchName: string;
    targetBranch: string | null;
    integratedAt: string | null;
  }>;
}
