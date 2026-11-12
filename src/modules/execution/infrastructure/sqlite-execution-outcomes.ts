import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import type { TaskOutcome } from '../domain/task-outcome.js';
import { parseJson } from './sqlite-execution-rows.js';

/** What each accepted task leaves in the graph: its summary, files and checks (Stage 2). */
export class SqliteTaskOutcomes {
  constructor(private readonly db: SqliteDatabase) {}

  recordTaskOutcome(outcome: TaskOutcome, repositoryId: string): number {
    return this.db
      .transaction(() => {
        const project = this.db.prepare('SELECT current_revision FROM projects WHERE id=?').get(outcome.projectId) as
          | { current_revision: number }
          | undefined;
        if (!project) throw new Error('Proyecto no encontrado.');
        const revision = project.current_revision + 1,
          now = new Date().toISOString();
        this.db
          .prepare(`INSERT INTO task_outcomes(work_item_id,project_id,execution_id,summary,files_json,checks_json,merged_commit,integration_branch,created_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(work_item_id) DO UPDATE SET execution_id=excluded.execution_id,summary=excluded.summary,files_json=excluded.files_json,checks_json=excluded.checks_json,merged_commit=excluded.merged_commit,integration_branch=excluded.integration_branch,created_at=excluded.created_at`)
          .run(
            outcome.workItemId,
            outcome.projectId,
            outcome.executionId,
            outcome.summary,
            JSON.stringify(outcome.files),
            JSON.stringify(outcome.checks),
            outcome.mergedCommit,
            outcome.integrationBranch,
            outcome.createdAt,
          );
        this.linkFiles(outcome, repositoryId, revision, now);
        this.db
          .prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?')
          .run(revision, now, outcome.projectId);
        return revision;
      })
      .immediate();
  }

  /** Each file of the merged commit: a graph document is GENERATED_BY the task; code gets its CODE_REFERENCE and MODIFIES. */
  private linkFiles(outcome: TaskOutcome, repositoryId: string, revision: number, now: string): void {
    const documents = new Map(
      (
        this.db
          .prepare(`SELECT a.relative_path AS path,a.entity_id AS id FROM artifacts a JOIN knowledge_entities e ON e.id=a.entity_id WHERE e.project_id=?
    UNION SELECT d.relative_path,d.entity_id FROM decision_records d JOIN knowledge_entities e ON e.id=d.entity_id WHERE e.project_id=?`)
          .all(outcome.projectId, outcome.projectId) as Array<{ path: string; id: string }>
      ).map(row => [row.path, row.id]),
    );
    const edgeExists = this.db.prepare(
      'SELECT 1 FROM graph_edges WHERE project_id=? AND source_id=? AND target_id=? AND edge_type=?',
    );
    const addEdge = (source: string, target: string, type: 'MODIFIES' | 'GENERATED_BY') => {
      if (!edgeExists.get(outcome.projectId, source, target, type))
        this.db
          .prepare(
            `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,?,'EXECUTION',NULL,?,NULL,?,?)`,
          )
          .run(
            globalThis.crypto.randomUUID(),
            outcome.projectId,
            source,
            target,
            type,
            outcome.executionId,
            revision,
            now,
          );
    };
    for (const file of outcome.files) {
      const documentId = documents.get(file.path);
      if (documentId) {
        addEdge(documentId, outcome.workItemId, 'GENERATED_BY');
        continue;
      }
      const codeId = this.upsertCodeReference(outcome, file, repositoryId, revision, now);
      addEdge(outcome.workItemId, codeId, 'MODIFIES');
    }
  }

  /** The CODE_REFERENCE of a file the task touched: updated when it exists (REMOVED if deleted), created otherwise. */
  private upsertCodeReference(
    outcome: TaskOutcome,
    file: TaskOutcome['files'][number],
    repositoryId: string,
    revision: number,
    now: string,
  ): string {
    const findCode = this.db.prepare(
      `SELECT c.entity_id FROM code_references c JOIN knowledge_entities e ON e.id=c.entity_id WHERE e.project_id=? AND c.file_path=?`,
    );
    const status = file.status === 'DELETED' ? 'REMOVED' : 'ACTIVE';
    let codeId = (findCode.get(outcome.projectId, file.path) as { entity_id: string } | undefined)?.entity_id;
    if (codeId) {
      this.db
        .prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=?')
        .run(status, revision, now, codeId);
      this.db
        .prepare('UPDATE code_references SET commit_sha=? WHERE entity_id=?')
        .run(outcome.mergedCommit ?? '', codeId);
    } else {
      codeId = globalThis.crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'CODE_REFERENCE',?,?,'',?,NULL,?,?,?,?)`,
        )
        .run(
          codeId,
          outcome.projectId,
          this.nextDisplayKey(outcome.projectId, 'CODE'),
          file.path,
          status,
          revision,
          revision,
          now,
          now,
        );
      this.db
        .prepare('INSERT INTO code_references(entity_id,repository_id,file_path,commit_sha) VALUES(?,?,?,?)')
        .run(codeId, repositoryId, file.path, outcome.mergedCommit ?? '');
    }
    return codeId;
  }

  findTaskOutcome(workItemId: string): TaskOutcome | null {
    const row = this.db.prepare('SELECT * FROM task_outcomes WHERE work_item_id=?').get(workItemId) as
      | {
          work_item_id: string;
          project_id: string;
          execution_id: string;
          summary: string;
          files_json: string;
          checks_json: string;
          merged_commit: string | null;
          integration_branch: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      workItemId: row.work_item_id,
      projectId: row.project_id,
      executionId: row.execution_id,
      summary: row.summary,
      files: parseJson(row.files_json, []),
      checks: parseJson(row.checks_json, []),
      mergedCommit: row.merged_commit,
      integrationBranch: row.integration_branch,
      createdAt: row.created_at,
    };
  }

  private nextDisplayKey(projectId: string, prefix: string): string {
    const rows = this.db
      .prepare('SELECT display_key FROM knowledge_entities WHERE project_id=? AND display_key LIKE ?')
      .all(projectId, `${prefix}-%`) as Array<{ display_key: string }>;
    const max = Math.max(0, ...rows.map(row => Number(row.display_key.slice(prefix.length + 1)) || 0));
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }
}
