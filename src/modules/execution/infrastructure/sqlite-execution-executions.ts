import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import { type AgentEvent, type AgentExecution, coveredWorkItems } from '../domain/models.js';
import type { ExecutionFileDiff } from './execution-validator.js';
import { type EventRow, type ExecutionRow, mapExecution, toRow } from './sqlite-execution-rows.js';

/** Runs, their events and their file diffs. */
export class SqliteExecutionRecords {
  constructor(private readonly db: SqliteDatabase) {}

  listFileDiffs(
    executionId: string,
  ): Array<{ filePath: string; changeType: string; additions: number; deletions: number; diffPatch: string | null }> {
    return (
      this.db
        .prepare(
          'SELECT file_path,change_type,additions,deletions,diff_patch FROM execution_file_diffs WHERE execution_id=? ORDER BY file_path',
        )
        .all(executionId) as Array<{
        file_path: string;
        change_type: string;
        additions: number;
        deletions: number;
        diff_patch: string | null;
      }>
    ).map(row => ({
      filePath: row.file_path,
      changeType: row.change_type,
      additions: row.additions,
      deletions: row.deletions,
      diffPatch: row.diff_patch,
    }));
  }

  recordFileDiffs(executionId: string, repositoryId: string, diffs: ExecutionFileDiff[]): void {
    const insert = this.db.prepare(
      `INSERT INTO execution_file_diffs(id,execution_id,repository_id,file_path,change_type,additions,deletions,diff_patch) VALUES(?,?,?,?,?,?,?,?)`,
    );
    this.db
      .transaction(() => {
        for (const diff of diffs)
          insert.run(
            globalThis.crypto.randomUUID(),
            executionId,
            repositoryId,
            diff.filePath,
            diff.changeType,
            diff.additions,
            diff.deletions,
            diff.diffPatch,
          );
      })
      .immediate();
  }

  createExecution(execution: AgentExecution): void {
    this.db
      .prepare(`INSERT INTO agent_executions
      (id,project_id,work_item_id,profile_id,provider_id,session_id,context_snapshot_id,status,model_used,initial_commit,final_commit,branch_or_worktree,base_branch,execution_branch,revision_of,review_status,review_note,merged_commit,reviewed_at,test_summary_json,result_summary,started_at,completed_at)
      VALUES (@id,@projectId,@workItemId,@profileId,@providerId,@sessionId,@contextSnapshotId,@status,@modelUsed,@initialCommit,@finalCommit,@branchOrWorktree,@baseBranch,@executionBranch,@revisionOf,@reviewStatus,@reviewNote,@mergedCommit,@reviewedAt,@testSummary,@resultSummary,@startedAt,@completedAt)`)
      .run(toRow(execution));
    const covered = coveredWorkItems(execution);
    if (covered.length > 1) {
      const insert = this.db.prepare(
        'INSERT INTO execution_work_items(execution_id,work_item_id,position) VALUES(?,?,?)',
      );
      covered.forEach((workItemId, position) => insert.run(execution.id, workItemId, position));
    }
  }

  updateExecution(execution: AgentExecution): void {
    const result = this.db
      .prepare(`UPDATE agent_executions SET session_id=@sessionId,context_snapshot_id=@contextSnapshotId,status=@status,model_used=@modelUsed,
      initial_commit=@initialCommit,final_commit=@finalCommit,branch_or_worktree=@branchOrWorktree,base_branch=@baseBranch,execution_branch=@executionBranch,revision_of=@revisionOf,review_status=@reviewStatus,review_note=@reviewNote,merged_commit=@mergedCommit,reviewed_at=@reviewedAt,
      test_summary_json=@testSummary,result_summary=@resultSummary,started_at=@startedAt,completed_at=@completedAt WHERE id=@id`)
      .run(toRow(execution));
    if (result.changes !== 1) throw new Error(`AgentExecution not found: ${execution.id}`);
  }

  findExecution(executionId: string): AgentExecution | null {
    const row = this.db.prepare('SELECT * FROM agent_executions WHERE id=?').get(executionId) as
      | ExecutionRow
      | undefined;
    return row ? mapExecution(row, this.coveredByExecution([row.id]).get(row.id)) : null;
  }

  listExecutions(projectId: string): AgentExecution[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM agent_executions WHERE project_id=? ORDER BY COALESCE(started_at,completed_at) DESC,id DESC',
      )
      .all(projectId) as ExecutionRow[];
    const covered = this.coveredByExecution(rows.map(row => row.id));
    return rows.map(row => mapExecution(row, covered.get(row.id)));
  }

  /** Tasks covered by each execution (grouped runs only), in position order. Executions without rows cover just their leader. */
  private coveredByExecution(executionIds: string[]): Map<string, string[]> {
    const covered = new Map<string, string[]>();
    if (!executionIds.length) return covered;
    const select = this.db.prepare(
      'SELECT execution_id,work_item_id FROM execution_work_items WHERE execution_id=? ORDER BY position',
    );
    for (const executionId of executionIds) {
      const ids = (select.all(executionId) as Array<{ execution_id: string; work_item_id: string }>).map(
        row => row.work_item_id,
      );
      if (ids.length) covered.set(executionId, ids);
    }
    return covered;
  }

  appendEvent(executionId: string, event: AgentEvent): { id: string; sequenceNo: number; createdAt: string } {
    const id = globalThis.crypto.randomUUID(),
      createdAt = new Date().toISOString();
    const sequenceNo = (
      this.db
        .prepare('SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM agent_events WHERE execution_id=?')
        .get(executionId) as { next: number }
    ).next;
    this.db
      .transaction(() => {
        this.db
          .prepare(
            'INSERT INTO agent_events(id,execution_id,sequence_no,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)',
          )
          .run(id, executionId, sequenceNo, event.type, JSON.stringify(event), createdAt);
        if (event.type === 'SESSION_INITIALIZED') {
          const execution = this.findExecution(executionId);
          if (execution) {
            const sessionId = globalThis.crypto.randomUUID();
            this.db
              .prepare(
                'INSERT INTO agent_sessions(id,project_id,provider_id,profile_id,external_session_id,status,created_at,last_active_at) VALUES(?,?,?,?,?,?,?,?)',
              )
              .run(
                sessionId,
                execution.projectId,
                execution.providerId,
                execution.profileId,
                event.externalSessionId,
                'ACTIVE',
                createdAt,
                createdAt,
              );
            this.db.prepare('UPDATE agent_executions SET session_id=? WHERE id=?').run(sessionId, executionId);
          }
        }
      })
      .immediate();
    return { id, sequenceNo, createdAt };
  }

  listEvents(executionId: string): Array<{ id: string; sequenceNo: number; createdAt: string; event: AgentEvent }> {
    return (
      this.db
        .prepare(
          'SELECT id,sequence_no,created_at,payload_json FROM agent_events WHERE execution_id=? ORDER BY sequence_no',
        )
        .all(executionId) as EventRow[]
    ).map(row => ({
      id: row.id,
      sequenceNo: row.sequence_no,
      createdAt: row.created_at,
      event: JSON.parse(row.payload_json) as AgentEvent,
    }));
  }

  externalSessionId(sessionId: string): string | null {
    return (
      (
        this.db.prepare('SELECT external_session_id FROM agent_sessions WHERE id=?').get(sessionId) as
          | { external_session_id: string | null }
          | undefined
      )?.external_session_id ?? null
    );
  }
}
