import type { SqliteDatabase } from '../../../platform/sqlite/database.js';

/** The project's stack and environment settings as the projects table stores them. */
export interface ProjectStackRow {
  stackProfileId: string | null;
  approvedDependenciesJson: string;
  skillsEnabled: boolean;
  techStackJson: string;
}

/** Reads and writes what decides a project's environment: stack profile, approved packages and bundled skills. */
export class SqliteProjectEnvironmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  stack(projectId: string): ProjectStackRow | undefined {
    const row = this.db
      .prepare(
        'SELECT stack_profile_id,approved_dependencies_json,skills_enabled,tech_stack_json FROM projects WHERE id=?',
      )
      .get(projectId) as
      | {
          stack_profile_id: string | null;
          approved_dependencies_json: string;
          skills_enabled: number;
          tech_stack_json: string;
        }
      | undefined;
    return row
      ? {
          stackProfileId: row.stack_profile_id,
          approvedDependenciesJson: row.approved_dependencies_json,
          skillsEnabled: row.skills_enabled === 1,
          techStackJson: row.tech_stack_json,
        }
      : undefined;
  }

  setSkillsEnabled(projectId: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE projects SET skills_enabled=?,updated_at=? WHERE id=?')
      .run(enabled ? 1 : 0, new Date().toISOString(), projectId);
  }

  setApprovedDependencies(projectId: string, packages: string[]): void {
    this.db
      .prepare('UPDATE projects SET approved_dependencies_json=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(packages), new Date().toISOString(), projectId);
  }

  /** Some of the tasks belongs to a feature documented by the given file (for example docs/UI_SPEC.md). */
  tasksDocumentedBy(taskIds: string[], relativePath: string): boolean {
    if (!taskIds.length) return false;
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM knowledge_entities t JOIN graph_edges e ON e.source_id=t.parent_id AND e.edge_type='DOCUMENTED_BY' JOIN artifacts a ON a.entity_id=e.target_id WHERE t.id IN (${taskIds.map(() => '?').join(',')}) AND a.relative_path=? LIMIT 1`,
        )
        .get(...taskIds, relativePath),
    );
  }
}
