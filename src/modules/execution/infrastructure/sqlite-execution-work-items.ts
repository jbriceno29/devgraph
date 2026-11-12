import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import { type WorkItem, type WorkItemStatus, canTransitionWorkItem } from '../../knowledge/index.js';
import { type WorkItemRow, parseCriteria } from './sqlite-execution-rows.js';

/** The tasks, their dependencies and their features, as the execution flow reads and moves them. */
export class SqliteExecutionWorkItems {
  constructor(private readonly db: SqliteDatabase) {}

  findWorkItem(projectId: string, workItemId: string): WorkItem | null {
    const row = this.db
      .prepare(`SELECT e.*,w.work_type,w.priority AS work_priority,w.scope_notes,w.acceptance_criteria_json,w.recommended_profile_role
      FROM knowledge_entities e JOIN work_items w ON w.entity_id=e.id
      WHERE e.project_id=? AND e.id=? AND e.entity_type='WORK_ITEM'`)
      .get(projectId, workItemId) as WorkItemRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      entityType: 'WORK_ITEM',
      displayKey: row.display_key,
      title: row.title,
      summary: row.summary,
      status: row.status,
      parentId: row.parent_id,
      createdRevision: row.created_revision,
      updatedRevision: row.updated_revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      workType: row.work_type,
      priority: row.work_priority,
      scopeNotes: row.scope_notes,
      acceptanceCriteria: parseCriteria(row.acceptance_criteria_json),
      recommendedProfileRole: row.recommended_profile_role,
    };
  }

  transitionWorkItem(projectId: string, workItemId: string, to: WorkItemStatus): number {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare(
            `SELECT e.status,p.current_revision FROM knowledge_entities e JOIN projects p ON p.id=e.project_id WHERE e.project_id=? AND e.id=? AND e.entity_type='WORK_ITEM'`,
          )
          .get(projectId, workItemId) as { status: WorkItemStatus; current_revision: number } | undefined;
        if (!row) throw new Error('La tarea no existe en este proyecto.');
        if (!canTransitionWorkItem(row.status, to))
          throw new Error(`Transición de tarea inválida: ${row.status} -> ${to}`);
        const revision = row.current_revision + 1,
          now = new Date().toISOString();
        this.db
          .prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=?')
          .run(to, revision, now, workItemId);
        this.db.prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?').run(revision, now, projectId);
        return revision;
      })
      .immediate();
  }

  listDependencies(
    projectId: string,
    workItemId: string,
  ): Array<{ id: string; displayKey: string; title: string; status: string }> {
    return (
      this.db
        .prepare(`SELECT k.id,k.display_key,k.title,k.status FROM graph_edges g JOIN knowledge_entities k ON k.id=g.target_id
      WHERE g.project_id=? AND g.source_id=? AND g.edge_type='DEPENDS_ON' AND k.entity_type='WORK_ITEM' ORDER BY k.display_key`)
        .all(projectId, workItemId) as Array<{ id: string; display_key: string; title: string; status: string }>
    ).map(row => ({ id: row.id, displayKey: row.display_key, title: row.title, status: row.status }));
  }

  listDependents(
    projectId: string,
    workItemId: string,
  ): Array<{ id: string; displayKey: string; title: string; status: string }> {
    return (
      this.db
        .prepare(`SELECT k.id,k.display_key,k.title,k.status FROM graph_edges g JOIN knowledge_entities k ON k.id=g.source_id
      WHERE g.project_id=? AND g.target_id=? AND g.edge_type='DEPENDS_ON' AND k.entity_type='WORK_ITEM' ORDER BY k.display_key`)
        .all(projectId, workItemId) as Array<{ id: string; display_key: string; title: string; status: string }>
    ).map(row => ({ id: row.id, displayKey: row.display_key, title: row.title, status: row.status }));
  }

  listFeatureTasks(
    projectId: string,
    featureId: string,
  ): Array<{ id: string; displayKey: string; title: string; status: string }> {
    return (
      this.db
        .prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM knowledge_entities WHERE project_id=? AND parent_id=? AND entity_type='WORK_ITEM'
      UNION SELECT k.id FROM knowledge_entities k JOIN tree t ON k.parent_id=t.id WHERE k.entity_type='WORK_ITEM')
      SELECT k.id,k.display_key,k.title,k.status FROM knowledge_entities k JOIN tree t ON t.id=k.id ORDER BY k.display_key`)
        .all(projectId, featureId) as Array<{ id: string; display_key: string; title: string; status: string }>
    ).map(row => ({ id: row.id, displayKey: row.display_key, title: row.title, status: row.status }));
  }

  listFeatureDependencies(
    projectId: string,
    featureId: string,
  ): Array<{ id: string; displayKey: string; title: string }> {
    const found = new Map<string, { id: string; displayKey: string; title: string }>();
    for (const row of this.db
      .prepare(`SELECT k.id,k.display_key,k.title FROM graph_edges g JOIN knowledge_entities k ON k.id=g.target_id
      WHERE g.project_id=? AND g.source_id=? AND g.edge_type='DEPENDS_ON' AND k.entity_type='FEATURE'`)
      .all(projectId, featureId) as Array<{ id: string; display_key: string; title: string }>)
      found.set(row.id, { id: row.id, displayKey: row.display_key, title: row.title });
    // Implicit: a task of this feature that depends on a task of another feature.
    for (const task of this.listFeatureTasks(projectId, featureId))
      for (const dependency of this.listDependencies(projectId, task.id)) {
        const other = this.findFeatureFor(projectId, dependency.id);
        if (other && other.id !== featureId && !found.has(other.id)) found.set(other.id, other);
      }
    return [...found.values()].sort((a, b) => a.displayKey.localeCompare(b.displayKey));
  }

  findFeatureFor(projectId: string, workItemId: string): { id: string; displayKey: string; title: string } | null {
    const lookup = this.db.prepare(
      'SELECT id,entity_type,display_key,title,parent_id FROM knowledge_entities WHERE project_id=? AND id=?',
    );
    let current = lookup.get(projectId, workItemId) as
      | { id: string; entity_type: string; display_key: string; title: string; parent_id: string | null }
      | undefined;
    for (let depth = 0; current && depth < 16; depth += 1) {
      if (current.entity_type === 'FEATURE')
        return { id: current.id, displayKey: current.display_key, title: current.title };
      current = current.parent_id ? (lookup.get(projectId, current.parent_id) as typeof current) : undefined;
    }
    return null;
  }

  listDocumentPaths(projectId: string): string[] {
    return (
      this.db
        .prepare(`SELECT a.relative_path AS path FROM artifacts a JOIN knowledge_entities e ON e.id=a.entity_id WHERE e.project_id=?
      UNION SELECT d.relative_path FROM decision_records d JOIN knowledge_entities e ON e.id=d.entity_id WHERE e.project_id=? ORDER BY 1`)
        .all(projectId, projectId) as Array<{ path: string }>
    ).map(row => row.path);
  }
}
