import type { SqliteDatabase } from '../sqlite/database.js';
import type { ActivityApprovalRow, ActivityChangeSetRow, ActivityExecutionRow, ActivityPilotRow, ActivitySnapshot, ActivitySourcePort, ActivityTaskRow } from '../../../application/ports/activity-port.js';
import type { AutonomyLevel } from '../../../domain/autonomy/models.js';

/** Read-only view over existing tables (work items, executions, pilot runs, ChangeSets, approvals) for the activity inbox. */
export class SqliteActivityRepository implements ActivitySourcePort {
  constructor(private readonly db: SqliteDatabase) {}

  snapshot(projectId: string, limit: number): ActivitySnapshot {
    const parents = new Map((this.db.prepare('SELECT id,entity_type,parent_id FROM knowledge_entities WHERE project_id=?').all(projectId) as Array<{ id: string; entity_type: string; parent_id: string | null }>).map(row => [row.id, row]));
    const featureOf = (id: string): string | null => { let current = parents.get(id); for (let depth = 0; current && depth < 16; depth += 1) { if (current.entity_type === 'FEATURE') return current.id; current = current.parent_id ? parents.get(current.parent_id) : undefined; } return null; };
    const taskSql = `SELECT id,display_key,title,status,updated_at FROM knowledge_entities WHERE project_id=? AND entity_type='WORK_ITEM'`;
    const taskRows = [
      ...this.db.prepare(`${taskSql} AND status IN ('READY','IN_PROGRESS','IN_REVIEW')`).all(projectId),
      ...this.db.prepare(`${taskSql} AND status='DONE' ORDER BY updated_at DESC, rowid DESC LIMIT ?`).all(projectId, limit),
    ] as Array<{ id: string; display_key: string; title: string; status: string; updated_at: string }>;
    const tasks: ActivityTaskRow[] = taskRows.map(row => ({ id: row.id, displayKey: row.display_key, title: row.title, status: row.status, updatedAt: row.updated_at, featureId: featureOf(row.id) }));
    const latestExecutions = (this.db.prepare(`SELECT id,work_item_id,status,review_status,started_at,completed_at,result_summary FROM (
        SELECT e.*, ROW_NUMBER() OVER (PARTITION BY work_item_id ORDER BY COALESCE(started_at,completed_at,'') DESC, rowid DESC) AS position FROM agent_executions e WHERE project_id=? AND work_item_id IS NOT NULL
      ) WHERE position=1`).all(projectId) as Array<{ id: string; work_item_id: string; status: string; review_status: string | null; started_at: string | null; completed_at: string | null; result_summary: string | null }>)
      .map((row): ActivityExecutionRow => ({ id: row.id, workItemId: row.work_item_id, status: row.status, reviewStatus: row.review_status, startedAt: row.started_at, completedAt: row.completed_at, resultSummary: row.result_summary }));
    const pilots = (this.db.prepare(`SELECT r.id,r.feature_id,r.status,r.reason,r.started_at,r.ended_at,f.display_key,f.title FROM (
        SELECT p.*, ROW_NUMBER() OVER (PARTITION BY feature_id ORDER BY started_at DESC, rowid DESC) AS position FROM pilot_runs p WHERE project_id=?
      ) r JOIN knowledge_entities f ON f.id=r.feature_id WHERE r.position=1`).all(projectId) as Array<{ id: string; feature_id: string; status: ActivityPilotRow['status']; reason: string | null; started_at: string; ended_at: string | null; display_key: string; title: string }>)
      .map((row): ActivityPilotRow => ({ id: row.id, featureId: row.feature_id, featureKey: row.display_key, featureTitle: row.title, status: row.status, reason: row.reason, startedAt: row.started_at, endedAt: row.ended_at }));
    const autonomy: Record<string, AutonomyLevel> = Object.fromEntries((this.db.prepare('SELECT feature_id,level FROM feature_autonomy WHERE project_id=?').all(projectId) as Array<{ feature_id: string; level: AutonomyLevel }>).map(row => [row.feature_id, row.level]));
    const proposalSql = `SELECT c.id,c.title,c.status,c.origin_ref_id,c.created_at,c.applied_at,e.work_item_id FROM change_sets c LEFT JOIN agent_executions e ON e.id=c.origin_ref_id WHERE c.project_id=? AND c.origin_type='AGENT_EXECUTION'`;
    const mapProposal = (row: { id: string; title: string; status: string; origin_ref_id: string | null; created_at: string; applied_at: string | null; work_item_id: string | null }): ActivityChangeSetRow => ({ id: row.id, title: row.title, status: row.status, executionId: row.origin_ref_id, workItemId: row.work_item_id, createdAt: row.created_at, appliedAt: row.applied_at });
    const pendingProposals = (this.db.prepare(`${proposalSql} AND c.status IN ('PENDING_APPROVAL','VALIDATED') ORDER BY c.created_at DESC`).all(projectId) as Parameters<typeof mapProposal>[0][]).map(mapProposal);
    const appliedProposals = (this.db.prepare(`${proposalSql} AND c.status='APPLIED' ORDER BY COALESCE(c.applied_at,c.created_at) DESC LIMIT ?`).all(projectId, limit) as Parameters<typeof mapProposal>[0][]).map(mapProposal);
    const pendingApprovals = (this.db.prepare(`SELECT a.id,a.execution_id,a.requested_action,a.reason,a.requested_at,e.work_item_id FROM approval_requests a JOIN agent_executions e ON e.id=a.execution_id
      WHERE e.project_id=? AND a.status='PENDING' AND e.status NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY a.requested_at DESC`).all(projectId) as Array<{ id: string; execution_id: string; requested_action: string; reason: string; requested_at: string; work_item_id: string | null }>)
      .map((row): ActivityApprovalRow => ({ id: row.id, executionId: row.execution_id, workItemId: row.work_item_id, requestedAction: row.requested_action, reason: row.reason, requestedAt: row.requested_at }));
    return { tasks, latestExecutions, pilots, autonomy, pendingProposals, appliedProposals, pendingApprovals };
  }
}
