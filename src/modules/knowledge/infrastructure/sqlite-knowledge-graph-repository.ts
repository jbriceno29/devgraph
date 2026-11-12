import type {
  DecisionStatusRepositoryPort,
  KnowledgeEntityDetails,
  ExecutionHistoryRecord,
  KnowledgeGraphRepositoryPort,
} from '../application/ports/knowledge-graph-repository-port.js';
import type { KnowledgeEntity, GraphRelationship } from '../domain/knowledge-entity.js';
import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
export class SqliteKnowledgeGraphRepository implements KnowledgeGraphRepositoryPort, DecisionStatusRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}
  findEntityById(id: string): KnowledgeEntity | null {
    const row = this.db.prepare('SELECT * FROM knowledge_entities WHERE id=?').get(id) as EntityRow | undefined;
    return row ? mapEntity(row) : null;
  }
  findEntityDetailsById(id: string): KnowledgeEntityDetails | null {
    const entity = this.findEntityById(id);
    if (!entity) return null;
    const table: Partial<Record<KnowledgeEntity['entityType'], string>> = {
      MODULE: 'modules',
      FEATURE: 'features',
      REQUIREMENT: 'requirements',
      WORK_ITEM: 'work_items',
      MILESTONE: 'milestones',
      DECISION_RECORD: 'decision_records',
      ARTIFACT: 'artifacts',
      CODE_REFERENCE: 'code_references',
    };
    const child = table[entity.entityType];
    if (!child) return { entity, attributes: {} };
    const row = this.db.prepare(`SELECT * FROM ${child} WHERE entity_id=?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { entity, attributes: {} };
    const attributes = { ...row };
    delete attributes.entity_id;
    for (const [key, value] of Object.entries(attributes))
      if (typeof value === 'string' && key.endsWith('_json')) {
        try {
          attributes[key.slice(0, -5)] = JSON.parse(value) as unknown;
          delete attributes[key];
        } catch {}
      }
    return { entity, attributes };
  }
  findExecutionHistory(entityId: string): ExecutionHistoryRecord[] {
    return (
      this.db
        .prepare(
          'SELECT DISTINCT e.id,e.status,e.started_at,e.completed_at,e.result_summary FROM agent_executions e LEFT JOIN graph_edges edge ON edge.execution_id=e.id WHERE e.work_item_id=? OR edge.source_id=? OR edge.target_id=? ORDER BY e.started_at DESC,e.id',
        )
        .all(entityId, entityId, entityId) as Array<{
        id: string;
        status: string;
        started_at: string | null;
        completed_at: string | null;
        result_summary: string | null;
      }>
    ).map(r => ({
      id: r.id,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      resultSummary: r.result_summary,
    }));
  }
  listEntities(projectId: string): KnowledgeEntity[] {
    return (
      this.db
        .prepare('SELECT * FROM knowledge_entities WHERE project_id=? ORDER BY display_key')
        .all(projectId) as EntityRow[]
    ).map(mapEntity);
  }
  listRelationships(projectId: string): GraphRelationship[] {
    return (
      this.db.prepare('SELECT * FROM graph_edges WHERE project_id=? ORDER BY created_at,id').all(projectId) as EdgeRow[]
    ).map(mapEdge);
  }
  insertEntity(e: KnowledgeEntity): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_entities (id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES (@id,@projectId,@entityType,@displayKey,@title,@summary,@status,@parentId,@createdRevision,@updatedRevision,@createdAt,@updatedAt)`,
      )
      .run(e);
  }
  setDecisionStatus(projectId: string, decisionId: string, from: string, to: string): number {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare(
            `SELECT p.current_revision FROM knowledge_entities e JOIN projects p ON p.id=e.project_id WHERE e.project_id=? AND e.id=? AND e.entity_type='DECISION_RECORD' AND e.status=?`,
          )
          .get(projectId, decisionId, from) as { current_revision: number } | undefined;
        if (!row) throw new Error('La decisión cambió mientras la editabas; vuelve a abrirla.');
        const revision = row.current_revision + 1,
          now = new Date().toISOString();
        this.db
          .prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=?')
          .run(to, revision, now, decisionId);
        if (to === 'ACCEPTED')
          this.db.prepare('UPDATE decision_records SET decided_at=? WHERE entity_id=?').run(now, decisionId);
        this.db.prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?').run(revision, now, projectId);
        return revision;
      })
      .immediate();
  }
  insertRelationship(e: GraphRelationship): void {
    this.db
      .prepare(
        `INSERT INTO graph_edges (id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES (@id,@projectId,@sourceId,@targetId,@edgeType,@provenance,@changeSetId,@executionId,@metadataJson,@createdRevision,@createdAt)`,
      )
      .run({
        ...e,
        changeSetId: e.changeSetId ?? null,
        executionId: e.executionId ?? null,
        metadataJson: e.metadata ? JSON.stringify(e.metadata) : null,
      });
  }
}
interface EntityRow {
  id: string;
  project_id: string;
  entity_type: KnowledgeEntity['entityType'];
  display_key: string;
  title: string;
  summary: string;
  status: string;
  parent_id: string | null;
  created_revision: number;
  updated_revision: number;
  created_at: string;
  updated_at: string;
}
interface EdgeRow {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  edge_type: GraphRelationship['edgeType'];
  provenance: GraphRelationship['provenance'];
  changeset_id: string | null;
  execution_id: string | null;
  metadata_json: string | null;
  created_revision: number;
  created_at: string;
}
const mapEntity = (r: EntityRow): KnowledgeEntity => ({
  id: r.id,
  projectId: r.project_id,
  entityType: r.entity_type,
  displayKey: r.display_key,
  title: r.title,
  summary: r.summary,
  status: r.status,
  parentId: r.parent_id,
  createdRevision: r.created_revision,
  updatedRevision: r.updated_revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const mapEdge = (r: EdgeRow): GraphRelationship => ({
  id: r.id,
  projectId: r.project_id,
  sourceId: r.source_id,
  targetId: r.target_id,
  edgeType: r.edge_type,
  provenance: r.provenance,
  changeSetId: r.changeset_id,
  executionId: r.execution_id,
  metadata: r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : null,
  createdRevision: r.created_revision,
  createdAt: r.created_at,
});
