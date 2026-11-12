import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import type { ApprovalRequest } from '../domain/governance.js';

/** Approval requests of runs that ask before acting. */
export class SqliteExecutionApprovals {
  constructor(private readonly db: SqliteDatabase) {}

  rejectPendingApprovals(executionId: string, note: string): void {
    this.db
      .prepare(
        `UPDATE approval_requests SET status='REJECTED',resolved_by='SYSTEM',resolution_note=?,resolved_at=? WHERE execution_id=? AND status='PENDING'`,
      )
      .run(note, new Date().toISOString(), executionId);
  }

  createApprovalRequest(request: ApprovalRequest): void {
    this.db
      .prepare(
        `INSERT INTO approval_requests(id,execution_id,scope,requested_action,reason,status,requested_at) VALUES(?,?,?,?,?,'PENDING',?)`,
      )
      .run(
        request.id,
        request.executionId,
        request.scope,
        request.requestedAction,
        request.reason,
        request.requestedAt,
      );
  }

  resolveApprovalRequest(requestId: string, decision: { approved: boolean; resolvedBy: string; note: string }): void {
    const result = this.db
      .prepare(
        `UPDATE approval_requests SET status=?,resolved_by=?,resolution_note=?,resolved_at=? WHERE id=? AND status='PENDING'`,
      )
      .run(
        decision.approved ? 'APPROVED' : 'REJECTED',
        decision.resolvedBy,
        decision.note,
        new Date().toISOString(),
        requestId,
      );
    if (result.changes !== 1) throw new Error('La solicitud de aprobación ya fue resuelta o no existe.');
  }
}
