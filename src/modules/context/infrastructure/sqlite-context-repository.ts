import type {
  ContextRepositoryPort,
  ContextEntityRecord,
  ContextExecutionSummary,
  ContextProjectRecord,
  ContextSearchHit,
  TraversedRelationship,
} from '../application/ports/context-engine-port.js';
import type { ContextSnapshot } from '../domain/context-snapshot.js';
import { SqliteKnowledgeGraphRepository } from '../../knowledge/index.js';
import type { SqliteDatabase } from '../../../platform/sqlite/database.js';

interface SnapshotRow {
  id: string;
  project_id: string;
  execution_id: string | null;
  focus_entity_id: string;
  repository_commit: string;
  graph_revision: number;
  constraints_json: string;
  included_sources_json: string;
  excluded_sources_json: string;
  token_usage_json: string;
  created_at: string;
}
export class SqliteContextRepository implements ContextRepositoryPort {
  private readonly graph: SqliteKnowledgeGraphRepository;
  constructor(private readonly db: SqliteDatabase) {
    this.graph = new SqliteKnowledgeGraphRepository(db);
  }
  findProjectContext(projectId: string): ContextProjectRecord | null {
    const row = this.db
      .prepare(
        `SELECT p.id,p.name,p.current_revision,p.rules_json,p.objectives_json,p.out_of_scope_json,p.tech_stack_json,r.local_path FROM projects p LEFT JOIN repositories r ON r.project_id=p.id AND r.is_primary=1 WHERE p.id=?`,
      )
      .get(projectId) as
      | {
          id: string;
          name: string;
          current_revision: number;
          rules_json: string;
          objectives_json: string;
          out_of_scope_json: string | null;
          tech_stack_json: string;
          local_path: string | null;
        }
      | undefined;
    const parse = <T>(json: string | null, fallback: T): T => {
      try {
        return json ? (JSON.parse(json) as T) : fallback;
      } catch {
        return fallback;
      }
    };
    return row
      ? {
          id: row.id,
          name: row.name,
          currentRevision: row.current_revision,
          rules: JSON.parse(row.rules_json) as string[],
          repositoryPath: row.local_path,
          objectives: parse(row.objectives_json, [] as string[]),
          outOfScope: parse(row.out_of_scope_json, [] as string[]),
          techStack: parse(row.tech_stack_json, {} as Record<string, unknown>),
        }
      : null;
  }
  listEntities(projectId: string) {
    return this.graph.listEntities(projectId);
  }
  listRelationships(projectId: string) {
    return this.graph.listRelationships(projectId);
  }
  traverseGraph(projectId: string, startEntityIds: string[], maxHops: number): TraversedRelationship[] {
    if (!startEntityIds.length || maxHops < 1) return [];
    const seeds = startEntityIds.map(() => `SELECT ? AS entity_id, 0 AS depth`).join(' UNION '),
      rows = this.db
        .prepare(
          `WITH RECURSIVE graph_walk(entity_id,depth) AS (${seeds} UNION SELECT CASE WHEN edge.source_id=graph_walk.entity_id THEN edge.target_id ELSE edge.source_id END,graph_walk.depth+1 FROM graph_walk JOIN graph_edges edge ON edge.source_id=graph_walk.entity_id OR edge.target_id=graph_walk.entity_id WHERE edge.project_id=? AND graph_walk.depth<?) SELECT edge.id AS edge_id,MIN(graph_walk.depth+1) AS graph_distance FROM graph_edges edge JOIN graph_walk ON edge.source_id=graph_walk.entity_id OR edge.target_id=graph_walk.entity_id WHERE edge.project_id=? AND graph_walk.depth<? GROUP BY edge.id ORDER BY graph_distance,edge.created_at,edge.id`,
        )
        .all(...startEntityIds, projectId, maxHops, projectId, maxHops) as Array<{
        edge_id: string;
        graph_distance: number;
      }>;
    const byId = new Map(this.graph.listRelationships(projectId).map(edge => [edge.id, edge]));
    return rows.flatMap(row => {
      const relationship = byId.get(row.edge_id);
      return relationship ? [{ relationship, graphDistance: row.graph_distance }] : [];
    });
  }
  findEntityRecord(entityId: string): ContextEntityRecord | null {
    const details = this.graph.findEntityDetailsById(entityId);
    if (!details) return null;
    const row = this.db.prepare('SELECT body_content FROM fts_knowledge_index WHERE entity_id=?').get(entityId) as
      | { body_content: string }
      | undefined;
    return { entity: details.entity, attributes: details.attributes, bodyContent: row?.body_content ?? '' };
  }
  search(projectId: string, query: string, limit: number): ContextSearchHit[] {
    const terms =
      query
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .match(/[\p{L}\p{N}_]+/gu)
        ?.slice(0, 12) ?? [];
    if (!terms.length) return [];
    const expression = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    const rows = this.db
      .prepare(
        `SELECT entity_id,bm25(fts_knowledge_index) AS rank FROM fts_knowledge_index WHERE fts_knowledge_index MATCH ? AND project_id=? ORDER BY rank LIMIT ?`,
      )
      .all(expression, projectId, limit) as Array<{ entity_id: string; rank: number }>;
    return rows.flatMap(row => {
      const record = this.findEntityRecord(row.entity_id);
      return record ? [{ record, relevanceScore: -row.rank }] : [];
    });
  }
  listExecutionSummaries(workItemId: string): ContextExecutionSummary[] {
    return (
      this.db
        .prepare(
          `SELECT id,status,completed_at,result_summary FROM agent_executions WHERE work_item_id=? AND status='COMPLETED' ORDER BY completed_at DESC,id LIMIT 5`,
        )
        .all(workItemId) as Array<{
        id: string;
        status: string;
        completed_at: string | null;
        result_summary: string | null;
      }>
    ).map(row => ({
      id: row.id,
      status: row.status,
      completedAt: row.completed_at,
      resultSummary: row.result_summary,
    }));
  }
  listTaskOutcomes(projectId: string): import('../../execution/index.js').TaskOutcome[] {
    return (
      this.db
        .prepare('SELECT work_item_id FROM task_outcomes WHERE project_id=? ORDER BY created_at,rowid')
        .all(projectId) as Array<{ work_item_id: string }>
    ).flatMap(row => {
      const outcome = this.findTaskOutcome(row.work_item_id);
      return outcome ? [outcome] : [];
    });
  }
  findTaskOutcome(workItemId: string): import('../../execution/index.js').TaskOutcome | null {
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
    const parse = <T>(json: string, fallback: T): T => {
      try {
        return JSON.parse(json) as T;
      } catch {
        return fallback;
      }
    };
    return {
      workItemId: row.work_item_id,
      projectId: row.project_id,
      executionId: row.execution_id,
      summary: row.summary,
      files: parse(row.files_json, []),
      checks: parse(row.checks_json, []),
      mergedCommit: row.merged_commit,
      integrationBranch: row.integration_branch,
      createdAt: row.created_at,
    };
  }
  updateArtifactDrift(entityId: string, contentHash: string, bodyContent: string): void {
    const entity = this.graph.findEntityById(entityId);
    if (!entity || !['ARTIFACT', 'DECISION_RECORD'].includes(entity.entityType)) return;
    this.db
      .transaction(() => {
        if (entity.entityType === 'ARTIFACT')
          this.db
            .prepare(`UPDATE artifacts SET content_hash=?,sync_status='DRIFTED' WHERE entity_id=?`)
            .run(contentHash, entityId);
        else
          this.db
            .prepare(`UPDATE decision_records SET content_hash=?,sync_status='DRIFTED' WHERE entity_id=?`)
            .run(contentHash, entityId);
        this.db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(bodyContent, entityId);
      })
      .immediate();
  }
  persistSnapshot(snapshot: ContextSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO context_snapshots(id,project_id,execution_id,focus_entity_id,repository_commit,graph_revision,constraints_json,included_sources_json,excluded_sources_json,token_usage_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        snapshot.id,
        snapshot.projectId,
        snapshot.executionId,
        snapshot.focusEntityId,
        snapshot.repositoryCommit,
        snapshot.graphRevision,
        JSON.stringify(snapshot.constraints),
        JSON.stringify(snapshot.includedSources),
        JSON.stringify(snapshot.excludedSources),
        JSON.stringify(snapshot.tokenUsage),
        snapshot.createdAt,
      );
  }
  findSnapshot(snapshotId: string): ContextSnapshot | null {
    const row = this.db.prepare('SELECT * FROM context_snapshots WHERE id=?').get(snapshotId) as
      | SnapshotRow
      | undefined;
    return row ? mapSnapshot(row) : null;
  }
}
function mapSnapshot(row: SnapshotRow): ContextSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    executionId: row.execution_id,
    focusEntityId: row.focus_entity_id,
    repositoryCommit: row.repository_commit,
    graphRevision: row.graph_revision,
    constraints: JSON.parse(row.constraints_json) as string[],
    includedSources: JSON.parse(row.included_sources_json) as ContextSnapshot['includedSources'],
    excludedSources: JSON.parse(row.excluded_sources_json) as ContextSnapshot['excludedSources'],
    tokenUsage: JSON.parse(row.token_usage_json) as ContextSnapshot['tokenUsage'],
    createdAt: row.created_at,
  };
}
