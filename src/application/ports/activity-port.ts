import type { AutonomyLevel, PilotStatus } from '../../domain/autonomy/models.js';

/** Raw facts the activity inbox derives its items from (read-only, existing tables). */
export interface ActivityTaskRow {
  id: string;
  displayKey: string;
  title: string;
  status: string;
  updatedAt: string;
  featureId: string | null;
}
export interface ActivityExecutionRow {
  id: string /** The task this row answers for (one row per covered task). */;
  workItemId: string | null /** Every task the execution covers, leader first; one entry unless the run was grouped. */;
  coveredWorkItemIds: string[];
  status: string;
  reviewStatus: string | null;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
}
export interface ActivityPilotRow {
  id: string;
  featureId: string;
  featureKey: string;
  featureTitle: string;
  status: PilotStatus;
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
}
export interface ActivityChangeSetRow {
  id: string;
  title: string;
  status: string;
  executionId: string | null;
  workItemId: string | null;
  createdAt: string;
  appliedAt: string | null;
}
export interface ActivityApprovalRow {
  id: string;
  executionId: string;
  workItemId: string | null;
  requestedAction: string;
  reason: string;
  requestedAt: string;
}
export interface ActivitySnapshot {
  /** Work items in READY, IN_PROGRESS, IN_REVIEW or DONE (DONE capped to the most recent `limit`). */
  tasks: ActivityTaskRow[];
  /** Latest execution per work item. */
  latestExecutions: ActivityExecutionRow[];
  /** Latest pilot run per feature. */
  pilots: ActivityPilotRow[];
  /** Autonomy level per feature (features without a row are MANUAL). */
  autonomy: Record<string, AutonomyLevel>;
  /** Agent plan proposals still waiting for the user. */
  pendingProposals: ActivityChangeSetRow[];
  /** Agent plan proposals already applied (most recent `limit`). */
  appliedProposals: ActivityChangeSetRow[];
  pendingApprovals: ActivityApprovalRow[];
  /** Integration branches of features (optional for fakes). */
  featureBranches?: Array<{ featureId: string; branchName: string; sourceBranch: string; integratedAt: string | null }>;
}
export interface ActivitySourcePort {
  snapshot(projectId: string, limit: number): ActivitySnapshot;
}
