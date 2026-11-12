import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import type { ChangeOperation } from '../domain/change-set.js';

/**
 * Plan REP, R3: the CODE_REFERENCE of a file the survey cited. A file the graph already knows (an accepted task touched
 * it, or an earlier survey cited it) keeps its node; otherwise a new one is created at the surveyed commit.
 */
export function upsertCodeReference(
  db: SqliteDatabase,
  op: Extract<ChangeOperation, { type: 'CREATE_CODE_REFERENCE' }>,
  ctx: { projectId: string; repositoryId: string | null; revision: number; now: string },
): string {
  const existing = db
    .prepare(
      `SELECT c.entity_id FROM code_references c JOIN knowledge_entities e ON e.id=c.entity_id WHERE e.project_id=? AND c.file_path=?`,
    )
    .get(ctx.projectId, op.filePath) as { entity_id: string } | undefined;
  if (existing) return existing.entity_id;
  if (!ctx.repositoryId) throw new Error('Falta el repositorio asociado a los archivos de código.');
  const id = globalThis.crypto.randomUUID();
  db.prepare(
    `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'CODE_REFERENCE',?,?,'','ACTIVE',NULL,?,?,?,?)`,
  ).run(id, ctx.projectId, nextCodeKey(db, ctx.projectId), op.filePath, ctx.revision, ctx.revision, ctx.now, ctx.now);
  db.prepare('INSERT INTO code_references(entity_id,repository_id,file_path,commit_sha) VALUES(?,?,?,?)').run(
    id,
    ctx.repositoryId,
    op.filePath,
    op.commitSha,
  );
  return id;
}

function nextCodeKey(db: SqliteDatabase, projectId: string): string {
  const rows = db
    .prepare(`SELECT display_key FROM knowledge_entities WHERE project_id=? AND display_key LIKE 'CODE-%'`)
    .all(projectId) as Array<{ display_key: string }>;
  const max = Math.max(0, ...rows.map(row => Number(row.display_key.slice(5)) || 0));
  return `CODE-${String(max + 1).padStart(3, '0')}`;
}
