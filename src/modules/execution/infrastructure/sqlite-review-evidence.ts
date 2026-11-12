import type { SqliteDatabase } from '../../../platform/sqlite/database.js';

/** What the change review reads from the workspace: the covered tasks with their criteria and the project's rules. */
export class SqliteReviewEvidence {
  constructor(private readonly db: SqliteDatabase) {}

  tasks(ids: string[]): Array<{ key: string; title: string; summary: string; criteria: string[] }> {
    return ids.flatMap(id => {
      const row = this.db
        .prepare(
          `SELECT k.display_key,k.title,k.summary,w.acceptance_criteria_json FROM knowledge_entities k JOIN work_items w ON w.entity_id=k.id WHERE k.id=?`,
        )
        .get(id) as
        | { display_key: string; title: string; summary: string | null; acceptance_criteria_json: string }
        | undefined;
      if (!row) return [];
      let criteria: string[] = [];
      try {
        criteria = (JSON.parse(row.acceptance_criteria_json) as Array<string | { description?: string }>)
          .map(item => (typeof item === 'string' ? item : String(item.description ?? '')))
          .filter(Boolean);
      } catch {
        /* none */
      }
      return [{ key: row.display_key, title: row.title, summary: row.summary ?? '', criteria }];
    });
  }

  rules(projectId: string): string[] {
    try {
      const row = this.db.prepare('SELECT rules_json FROM projects WHERE id=?').get(projectId) as {
        rules_json: string;
      };
      return JSON.parse(row.rules_json) as string[];
    } catch {
      return [];
    }
  }
}
