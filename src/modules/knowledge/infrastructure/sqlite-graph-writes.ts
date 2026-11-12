import { createHash } from 'node:crypto';
import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import { seedDefaultPolicy } from '../../execution/index.js';
import type { StagedMarkdownFile } from '../../planning/index.js';
import { findStackProfile } from '../../projects/index.js';
import type { ChangeOperation, ChangeSet } from '../domain/change-set.js';

export type CreateOperation = Extract<
  ChangeOperation,
  {
    type:
      | 'CREATE_MODULE'
      | 'CREATE_FEATURE'
      | 'CREATE_REQUIREMENT'
      | 'CREATE_WORK_ITEM'
      | 'CREATE_DECISION_RECORD'
      | 'UPSERT_ARTIFACT';
  }
>;

/** What one application of a ChangeSet shares: its revision, the ids given to temporary refs and the staged documents. */
export interface ApplyContext {
  changeSet: ChangeSet;
  revision: number;
  now: string;
  repositoryId: string | null;
  ids: Record<string, string>;
  files: StagedMarkdownFile[];
  resolve(id: string | undefined | null): string | null;
}

const ENTITY_TYPE: Record<CreateOperation['type'], string> = {
  CREATE_MODULE: 'MODULE',
  CREATE_FEATURE: 'FEATURE',
  CREATE_REQUIREMENT: 'REQUIREMENT',
  CREATE_WORK_ITEM: 'WORK_ITEM',
  CREATE_DECISION_RECORD: 'DECISION_RECORD',
  UPSERT_ARTIFACT: 'ARTIFACT',
};
const KEY_PREFIX: Record<string, string> = {
  MODULE: 'MOD',
  FEATURE: 'FEAT',
  REQUIREMENT: 'REQ',
  WORK_ITEM: 'TASK',
  DECISION_RECORD: 'ADR',
  ARTIFACT: 'DOC',
};
const EDGE_INSERT = `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,?,'CHANGESET',?,NULL,?,?,?)`;

/** Every write a ChangeSet makes in the graph, inside the applier's transaction (A3: split out of the applier). */
export class SqliteGraphWrites {
  constructor(private readonly db: SqliteDatabase) {}

  /** A new entity: its row, its key (MOD-001, TASK-004…), its type-specific row and its search text. */
  insertCreate(op: CreateOperation, ctx: ApplyContext): void {
    const entityId = globalThis.crypto.randomUUID();
    if ('tempId' in op && op.tempId) ctx.ids[op.tempId] = entityId;
    const type = ENTITY_TYPE[op.type];
    const parentId = ctx.resolve(parentOf(op));
    const key = this.nextKey(ctx.changeSet.projectId, KEY_PREFIX[type]!);
    const summary = 'summary' in op ? op.summary : '';
    this.db
      .prepare(
        `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entityId,
        ctx.changeSet.projectId,
        type,
        key,
        op.title,
        summary,
        'DRAFT',
        parentId,
        ctx.revision,
        ctx.revision,
        ctx.now,
        ctx.now,
      );
    this.insertDetails(op, entityId, key, parentId, ctx);
    this.db
      .prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?')
      .run(
        op.type === 'UPSERT_ARTIFACT'
          ? op.markdownContent
          : op.type === 'CREATE_DECISION_RECORD'
            ? decisionMarkdown(op)
            : summary,
        entityId,
      );
  }

  private insertDetails(
    op: CreateOperation,
    entityId: string,
    key: string,
    parentId: string | null,
    ctx: ApplyContext,
  ) {
    if (op.type === 'CREATE_MODULE')
      this.db
        .prepare('INSERT INTO modules(entity_id,purpose,module_kind) VALUES(?,?,?)')
        .run(entityId, op.purpose, op.moduleKind ?? 'FUNCTIONAL');
    else if (op.type === 'CREATE_FEATURE')
      this.db
        .prepare('INSERT INTO features(entity_id,scope,priority) VALUES(?,?,?)')
        .run(entityId, op.scope, op.priority);
    else if (op.type === 'CREATE_REQUIREMENT')
      this.db
        .prepare('INSERT INTO requirements(entity_id,req_type,priority,acceptance_criteria_json) VALUES(?,?,?,?)')
        .run(entityId, op.reqType, op.priority, JSON.stringify(op.acceptanceCriteria));
    else if (op.type === 'CREATE_WORK_ITEM')
      this.db
        .prepare(
          'INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,?,?,?,?)',
        )
        .run(
          entityId,
          op.workType,
          op.priority ?? 'MEDIUM',
          JSON.stringify(op.acceptanceCriteria),
          op.recommendedProfileRole ?? null,
        );
    else if (op.type === 'CREATE_DECISION_RECORD') {
      const file = ctx.files.find(f => f.relativePath === op.relativePath)!;
      this.db
        .prepare(
          `INSERT INTO decision_records(entity_id,adr_number,context_md,alternatives_md,decision_md,consequences_md,relative_path,content_hash,sync_status,decided_at) VALUES(?,?,?,?,?,?,?,?,'SYNCED',?)`,
        )
        .run(
          entityId,
          Number(key.slice(4)),
          op.contextMd,
          op.alternativesMd,
          op.decisionMd,
          op.consequencesMd,
          op.relativePath,
          hash(file.content),
          ctx.now,
        );
    } else if (op.type === 'UPSERT_ARTIFACT') {
      if (!ctx.repositoryId) throw new Error('Falta el repositorio asociado al documento.');
      const file = ctx.files.find(f => f.relativePath === op.relativePath)!;
      this.db
        .prepare(
          "INSERT INTO artifacts(entity_id,repository_id,artifact_type,relative_path,version,content_hash,sync_status) VALUES(?,?,?,?,1,?,'SYNCED')",
        )
        .run(entityId, ctx.repositoryId, op.artifactType, op.relativePath, hash(file.content));
      if (parentId) this.edge(ctx, op.parentId!, entityId, 'DOCUMENTED_BY');
    }
  }

  /** The operations that are not creations: relationships, statuses, the project profile and artifact updates. */
  applyOperation(op: ChangeOperation, ctx: ApplyContext): void {
    const projectId = ctx.changeSet.projectId;
    if (op.type === 'CREATE_RELATIONSHIP') {
      const source = ctx.resolve(op.sourceId),
        target = ctx.resolve(op.targetId);
      if (!source || !target) throw new Error('Relación con referencia temporal sin resolver.');
      this.db
        .prepare(EDGE_INSERT)
        .run(
          globalThis.crypto.randomUUID(),
          projectId,
          source,
          target,
          op.edgeType,
          ctx.changeSet.id,
          op.metadata ? JSON.stringify(op.metadata) : null,
          ctx.revision,
          ctx.now,
        );
    } else if (op.type === 'DELETE_RELATIONSHIP')
      this.db.prepare('DELETE FROM graph_edges WHERE id=? AND project_id=?').run(ctx.resolve(op.edgeId), projectId);
    else if (op.type === 'SET_PROJECT_PROFILE') this.applyProfile(projectId, op, ctx.now);
    else if (op.type === 'UPDATE_ENTITY_STATUS')
      this.db
        .prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=? AND project_id=?')
        .run(op.newStatus, ctx.revision, ctx.now, ctx.resolve(op.entityId), projectId);
    else if (op.type === 'UPSERT_ARTIFACT' && op.entityId && !op.tempId) this.updateArtifact(op, ctx);
  }

  private updateArtifact(op: Extract<ChangeOperation, { type: 'UPSERT_ARTIFACT' }>, ctx: ApplyContext): void {
    const file = ctx.files.find(f => f.relativePath === op.relativePath)!;
    const result = this.db
      .prepare(
        "UPDATE artifacts SET artifact_type=?,content_hash=?,sync_status='SYNCED',version=version+1 WHERE entity_id=? AND entity_id IN (SELECT id FROM knowledge_entities WHERE project_id=?)",
      )
      .run(op.artifactType, hash(file.content), op.entityId, ctx.changeSet.projectId);
    if (result.changes !== 1) throw new Error('El Artifact indicado dejó de existir antes del commit.');
    this.db
      .prepare('UPDATE knowledge_entities SET title=?,updated_revision=?,updated_at=? WHERE id=?')
      .run(op.title, ctx.revision, ctx.now, op.entityId);
    this.db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(file.content, op.entityId);
  }

  /** Each written document's text goes to the search index of its entity. */
  indexFiles(ctx: ApplyContext): void {
    for (const file of ctx.files) {
      const operation = ctx.changeSet.operations.find(
        op =>
          (op.type === 'UPSERT_ARTIFACT' || op.type === 'CREATE_DECISION_RECORD') &&
          op.relativePath === file.relativePath,
      )!;
      const entityId =
        operation.type === 'UPSERT_ARTIFACT' && operation.entityId && !operation.tempId
          ? operation.entityId
          : 'tempId' in operation && operation.tempId
            ? ctx.ids[operation.tempId]
            : undefined;
      if (entityId)
        this.db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(file.content, entityId);
    }
  }

  /** Profile fields replace the project's; verification commands become the allowed commands of every project policy. */
  private applyProfile(
    projectId: string,
    op: Extract<ChangeOperation, { type: 'SET_PROJECT_PROFILE' }>,
    now: string,
  ): void {
    this.db
      .prepare(
        'UPDATE projects SET objectives_json=?,out_of_scope_json=?,tech_stack_json=?,rules_json=?,description=COALESCE(?,description),stack_profile_id=?,updated_at=? WHERE id=?',
      )
      .run(
        JSON.stringify(op.objectives),
        JSON.stringify(op.outOfScope),
        JSON.stringify(op.techStack),
        JSON.stringify(op.rules),
        op.description ?? null,
        op.stackProfileId ?? null,
        now,
        projectId,
      );
    seedDefaultPolicy(this.db, projectId);
    this.db
      .prepare('UPDATE autonomy_policies SET allowed_commands_json=? WHERE project_id=?')
      .run(JSON.stringify([...new Set(op.verificationCommands)]), projectId);
    // The stack profile adds its root files (plan S1); an existing repository's own paths replace the defaults (REP R1).
    const extra = findStackProfile(op.stackProfileId)?.writablePaths ?? [];
    if (extra.length || op.writablePaths?.length)
      for (const row of this.db
        .prepare('SELECT id,writable_paths_json FROM autonomy_policies WHERE project_id=?')
        .all(projectId) as Array<{ id: string; writable_paths_json: string }>) {
        const current = op.writablePaths?.length ? op.writablePaths : (JSON.parse(row.writable_paths_json) as string[]);
        this.db
          .prepare('UPDATE autonomy_policies SET writable_paths_json=? WHERE id=?')
          .run(JSON.stringify([...new Set([...current, ...extra])]), row.id);
      }
  }

  private edge(ctx: ApplyContext, sourceRef: string, target: string, type: 'AFFECTS' | 'DOCUMENTED_BY'): void {
    const source = ctx.ids[sourceRef] ?? sourceRef;
    this.db
      .prepare(EDGE_INSERT)
      .run(
        globalThis.crypto.randomUUID(),
        ctx.changeSet.projectId,
        source,
        target,
        type,
        ctx.changeSet.id,
        null,
        ctx.revision,
        ctx.now,
      );
  }

  private nextKey(projectId: string, prefix: string): string {
    const rows = this.db
      .prepare('SELECT display_key FROM knowledge_entities WHERE project_id=? AND display_key LIKE ?')
      .all(projectId, `${prefix}-%`) as Array<{ display_key: string }>;
    const max = Math.max(0, ...rows.map(r => Number(r.display_key.slice(prefix.length + 1)) || 0));
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }
}

export function isCreate(op: ChangeOperation): op is CreateOperation {
  return (
    ['CREATE_MODULE', 'CREATE_FEATURE', 'CREATE_REQUIREMENT', 'CREATE_WORK_ITEM', 'CREATE_DECISION_RECORD'].includes(
      op.type,
    ) ||
    (op.type === 'UPSERT_ARTIFACT' && (!op.entityId || !!op.tempId))
  );
}
export function parentOf(op: ChangeOperation): string | null {
  if (op.type === 'CREATE_FEATURE') return op.moduleId;
  if (op.type === 'CREATE_REQUIREMENT' || op.type === 'CREATE_MODULE' || op.type === 'UPSERT_ARTIFACT')
    return op.parentId ?? null;
  if (op.type === 'CREATE_WORK_ITEM') return op.parentId;
  return null;
}
export function decisionMarkdown(op: Extract<ChangeOperation, { type: 'CREATE_DECISION_RECORD' }>): string {
  return `# ${op.title}\n\n## Context\n${op.contextMd}\n\n## Alternatives\n${op.alternativesMd}\n\n## Decision\n${op.decisionMd}\n\n## Consequences\n${op.consequencesMd}\n`;
}
export function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
