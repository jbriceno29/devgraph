import { randomUUID } from 'node:crypto';
import type {
  ArtifactRepositoryPort,
  ArtifactDocumentCreateRecord,
  ArtifactDocumentRecord,
  DecisionRecordCreateRecord,
} from '../../../application/ports/artifact-management-port.js';
import type { ArtifactSyncStatus } from '../../../domain/artifacts/entities.js';
import type { SqliteDatabase } from '../sqlite/database.js';

export class SqliteArtifactRepository implements ArtifactRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}

  listDocuments(projectId: string): ArtifactDocumentRecord[] {
    return (
      this.db
        .prepare(
          `${selectDocumentSql} WHERE e.entity_type IN ('ARTIFACT','DECISION_RECORD') AND e.project_id=? ORDER BY e.entity_type,e.display_key`,
        )
        .all(projectId) as DocumentRow[]
    ).map(mapDocument);
  }
  findDocumentById(id: string): ArtifactDocumentRecord | null {
    const row = this.db
      .prepare(`${selectDocumentSql} WHERE e.entity_type IN ('ARTIFACT','DECISION_RECORD') AND e.id=?`)
      .get(id) as DocumentRow | undefined;
    return row ? mapDocument(row) : null;
  }
  findDocumentByPath(projectId: string, relativePath: string): ArtifactDocumentRecord | null {
    const row = this.db
      .prepare(
        `${selectDocumentSql} WHERE e.entity_type IN ('ARTIFACT','DECISION_RECORD') AND e.project_id=? AND COALESCE(a.relative_path,d.relative_path)=?`,
      )
      .get(projectId, relativePath) as DocumentRow | undefined;
    return row ? mapDocument(row) : null;
  }
  createArtifact(record: ArtifactDocumentCreateRecord): void {
    this.db
      .transaction(() => {
        insertEntity(this.db, record.entity);
        this.db
          .prepare(
            `INSERT INTO artifacts (entity_id,repository_id,artifact_type,relative_path,version,content_hash,sync_status) VALUES (?,?,?,?,?,?, 'SYNCED')`,
          )
          .run(
            record.entity.id,
            record.repositoryId,
            record.artifactType,
            record.relativePath,
            record.version,
            record.contentHash,
          );
        insertEdge(this.db, record.link);
        updateBody(this.db, record.entity.id, record.bodyContent);
        bumpRevision(this.db, record.entity.projectId, record.entity.updatedAt);
      })
      .immediate();
  }
  createDecisionRecord(record: DecisionRecordCreateRecord): void {
    this.db
      .transaction(() => {
        insertEntity(this.db, record.entity);
        this.db
          .prepare(
            `INSERT INTO decision_records (entity_id,adr_number,context_md,alternatives_md,decision_md,consequences_md,relative_path,content_hash,sync_status,decided_at) VALUES (?,?,?,?,?,?,?,?,'SYNCED',?)`,
          )
          .run(
            record.entity.id,
            record.adrNumber,
            record.contextMd,
            record.alternativesMd,
            record.decisionMd,
            record.consequencesMd,
            record.relativePath,
            record.contentHash,
            record.decidedAt,
          );
        insertEdge(this.db, record.link);
        updateBody(this.db, record.entity.id, record.bodyContent);
        bumpRevision(this.db, record.entity.projectId, record.entity.updatedAt);
      })
      .immediate();
  }
  updateDocumentContent(
    id: string,
    contentHash: string,
    syncStatus: ArtifactSyncStatus,
    bodyContent: string,
    fields: {
      title?: string;
      contextMd?: string;
      alternativesMd?: string;
      decisionMd?: string;
      consequencesMd?: string;
    } = {},
  ): void {
    const document = this.findDocumentById(id);
    if (!document) throw new Error(`Document not found: ${id}`);
    this.db
      .transaction(() => {
        if (document.entityType === 'ARTIFACT')
          this.db
            .prepare('UPDATE artifacts SET content_hash=?,sync_status=? WHERE entity_id=?')
            .run(contentHash, syncStatus, id);
        else
          this.db
            .prepare(
              `UPDATE decision_records SET content_hash=?,sync_status=?,context_md=COALESCE(?,context_md),alternatives_md=COALESCE(?,alternatives_md),decision_md=COALESCE(?,decision_md),consequences_md=COALESCE(?,consequences_md) WHERE entity_id=?`,
            )
            .run(
              contentHash,
              syncStatus,
              fields.contextMd ?? null,
              fields.alternativesMd ?? null,
              fields.decisionMd ?? null,
              fields.consequencesMd ?? null,
              id,
            );
        if (fields.title !== undefined)
          this.db
            .prepare('UPDATE knowledge_entities SET title=?,updated_at=? WHERE id=?')
            .run(fields.title, new Date().toISOString(), id);
        updateBody(this.db, id, bodyContent);
      })
      .immediate();
  }
}

const selectDocumentSql = `SELECT e.id,e.project_id,e.display_key,e.title,e.summary,e.entity_type,
 CASE WHEN e.entity_type='ARTIFACT' THEN a.artifact_type ELSE NULL END AS artifact_type,
 CASE WHEN e.entity_type='ARTIFACT' THEN a.version ELSE NULL END AS version,
 CASE WHEN e.entity_type='DECISION_RECORD' THEN d.adr_number ELSE NULL END AS adr_number,
 COALESCE(a.relative_path,d.relative_path) AS relative_path,
 COALESCE(a.content_hash,d.content_hash) AS content_hash,
 COALESCE(a.sync_status,d.sync_status) AS sync_status,
 d.context_md,d.alternatives_md,d.decision_md,d.consequences_md
 FROM knowledge_entities e LEFT JOIN artifacts a ON a.entity_id=e.id LEFT JOIN decision_records d ON d.entity_id=e.id`;
interface DocumentRow {
  id: string;
  project_id: string;
  display_key: string;
  title: string;
  summary: string;
  entity_type: 'ARTIFACT' | 'DECISION_RECORD';
  artifact_type: string | null;
  version: number | null;
  adr_number: number | null;
  relative_path: string;
  content_hash: string;
  sync_status: ArtifactSyncStatus;
  context_md: string | null;
  alternatives_md: string | null;
  decision_md: string | null;
  consequences_md: string | null;
}
const mapDocument = (r: DocumentRow): ArtifactDocumentRecord => ({
  id: r.id,
  projectId: r.project_id,
  displayKey: r.display_key,
  title: r.title,
  summary: r.summary,
  entityType: r.entity_type,
  artifactType: r.artifact_type,
  version: r.version,
  adrNumber: r.adr_number,
  relativePath: r.relative_path,
  contentHash: r.content_hash,
  syncStatus: r.sync_status,
  contextMd: r.context_md,
  alternativesMd: r.alternatives_md,
  decisionMd: r.decision_md,
  consequencesMd: r.consequences_md,
});
function insertEntity(db: SqliteDatabase, e: ArtifactDocumentCreateRecord['entity']): void {
  db.prepare(
    `INSERT INTO knowledge_entities (id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES (@id,@projectId,@entityType,@displayKey,@title,@summary,@status,@parentId,@createdRevision,@updatedRevision,@createdAt,@updatedAt)`,
  ).run(e);
}
function insertEdge(db: SqliteDatabase, e: ArtifactDocumentCreateRecord['link']): void {
  db.prepare(
    `INSERT INTO graph_edges (id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?,?)`,
  ).run(e.id, e.projectId, e.sourceId, e.targetId, e.edgeType, e.provenance, e.createdRevision, e.createdAt);
}
function updateBody(db: SqliteDatabase, id: string, body: string): void {
  db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(body, id);
}
function bumpRevision(db: SqliteDatabase, projectId: string, updatedAt: string): void {
  db.prepare('UPDATE projects SET current_revision=current_revision+1,updated_at=? WHERE id=?').run(
    updatedAt,
    projectId,
  );
}
export function createGraphLinkId(): string {
  return randomUUID();
}
