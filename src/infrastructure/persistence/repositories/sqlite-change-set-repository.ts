import type { ChangeSetRepositoryPort } from '../../../application/ports/change-set-planning-port.js';
import type { ChangeSet } from '../../../domain/knowledge/change-set.js';
import type { SqliteDatabase } from '../sqlite/database.js';
interface Row {
  id: string;
  project_id: string;
  base_graph_revision: number;
  applied_graph_revision: number | null;
  origin_type: ChangeSet['originType'];
  origin_ref_id: string | null;
  title: string;
  rationale: string;
  status: ChangeSet['status'];
  operations_json: string;
  validation_errors_json: string;
  created_at: string;
  applied_at: string | null;
}
const map = (r: Row): ChangeSet => ({
  id: r.id,
  projectId: r.project_id,
  baseGraphRevision: r.base_graph_revision,
  ...(r.applied_graph_revision === null ? {} : { appliedGraphRevision: r.applied_graph_revision }),
  originType: r.origin_type,
  ...(r.origin_ref_id === null ? {} : { originRefId: r.origin_ref_id }),
  title: r.title,
  rationale: r.rationale,
  status: r.status,
  operations: JSON.parse(r.operations_json) as ChangeSet['operations'],
  validationIssues: JSON.parse(r.validation_errors_json) as ChangeSet['validationIssues'],
  createdAt: r.created_at,
  ...(r.applied_at === null ? {} : { appliedAt: r.applied_at }),
});
export class SqliteChangeSetRepository implements ChangeSetRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}
  findById(id: string): ChangeSet | null {
    const row = this.db.prepare('SELECT * FROM change_sets WHERE id=?').get(id) as Row | undefined;
    return row ? map(row) : null;
  }
  list(projectId: string): ChangeSet[] {
    return (
      this.db.prepare('SELECT * FROM change_sets WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Row[]
    ).map(map);
  }
  save(value: ChangeSet): void {
    this.db
      .prepare(
        `INSERT INTO change_sets(id,project_id,base_graph_revision,applied_graph_revision,origin_type,origin_ref_id,title,rationale,status,operations_json,validation_errors_json,created_at,applied_at) VALUES(@id,@projectId,@baseGraphRevision,@appliedGraphRevision,@originType,@originRefId,@title,@rationale,@status,@operationsJson,@validationErrorsJson,@createdAt,@appliedAt) ON CONFLICT(id) DO UPDATE SET applied_graph_revision=excluded.applied_graph_revision,title=excluded.title,rationale=excluded.rationale,status=excluded.status,operations_json=excluded.operations_json,validation_errors_json=excluded.validation_errors_json,applied_at=excluded.applied_at`,
      )
      .run({
        ...value,
        appliedGraphRevision: value.appliedGraphRevision ?? null,
        originRefId: value.originRefId ?? null,
        operationsJson: JSON.stringify(value.operations),
        validationErrorsJson: JSON.stringify(value.validationIssues),
        appliedAt: value.appliedAt ?? null,
      });
  }
}
