import type { InceptionRecord, InceptionRepositoryPort } from '../../../application/ports/inception-port.js';
import type { SqliteDatabase } from '../sqlite/database.js';

interface Row { project_id: string; stage: InceptionRecord['stage']; status: InceptionRecord['status']; brief: string; questions_json: string; answers_json: string; assumptions_json: string; change_set_id: string | null; model: string | null; usage_json: string; error: string | null; notes_json: string; scaffold_task_id: string | null; references_json?: string; created_at: string; updated_at: string }
const parse = <T,>(json: string, fallback: T): T => { try { return JSON.parse(json) as T; } catch { return fallback; } };

export class SqliteInceptionRepository implements InceptionRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}
  find(projectId: string): InceptionRecord | null {
    const row = this.db.prepare('SELECT * FROM project_inception WHERE project_id=?').get(projectId) as Row | undefined;
    return row ? { projectId: row.project_id, stage: row.stage, status: row.status, brief: row.brief, questions: parse(row.questions_json, []), answers: parse(row.answers_json, []), assumptions: parse(row.assumptions_json, []), changeSetId: row.change_set_id, model: row.model, usage: parse(row.usage_json, []), error: row.error, notes: parse(row.notes_json, []), scaffoldTaskId: row.scaffold_task_id ?? null, references: parse(row.references_json ?? '[]', []), createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  save(record: InceptionRecord): void {
    this.db.prepare(`INSERT INTO project_inception(project_id,stage,status,brief,questions_json,answers_json,assumptions_json,change_set_id,model,usage_json,error,notes_json,scaffold_task_id,references_json,created_at,updated_at)
      VALUES(@projectId,@stage,@status,@brief,@questions,@answers,@assumptions,@changeSetId,@model,@usage,@error,@notes,@scaffoldTaskId,@references,@createdAt,@updatedAt)
      ON CONFLICT(project_id) DO UPDATE SET stage=excluded.stage,status=excluded.status,brief=excluded.brief,questions_json=excluded.questions_json,answers_json=excluded.answers_json,assumptions_json=excluded.assumptions_json,change_set_id=excluded.change_set_id,model=excluded.model,usage_json=excluded.usage_json,error=excluded.error,notes_json=excluded.notes_json,scaffold_task_id=excluded.scaffold_task_id,references_json=excluded.references_json,created_at=excluded.created_at,updated_at=excluded.updated_at`)
      .run({ ...record, questions: JSON.stringify(record.questions), answers: JSON.stringify(record.answers), assumptions: JSON.stringify(record.assumptions), usage: JSON.stringify(record.usage), notes: JSON.stringify(record.notes ?? []), scaffoldTaskId: record.scaffoldTaskId ?? null, references: JSON.stringify(record.references ?? []) });
  }
  delete(projectId: string): void { this.db.prepare('DELETE FROM project_inception WHERE project_id=?').run(projectId); }
}
