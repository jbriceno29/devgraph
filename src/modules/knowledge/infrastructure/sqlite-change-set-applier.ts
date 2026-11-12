import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import type { DocumentCommitPort, RepositoryLocationRepositoryPort } from '../../documents/index.js';
import type { ChangeSetApplyPort, StagedMarkdownFile, TransactionalMarkdownFilePort } from '../../planning/index.js';
import type { ChangeSet } from '../domain/change-set.js';
import { type ApplyContext, SqliteGraphWrites, decisionMarkdown, isCreate, parentOf } from './sqlite-graph-writes.js';

/**
 * Applies a validated ChangeSet: its documents are written atomically together with one SQLite transaction (checked
 * against the graph revision it was planned on), and then committed so runs, which start from Git, see them (D6).
 */
export class SqliteChangeSetApplier implements ChangeSetApplyPort {
  private readonly writes: SqliteGraphWrites;
  constructor(
    private readonly db: SqliteDatabase,
    private readonly files: TransactionalMarkdownFilePort,
    private readonly repositories: RepositoryLocationRepositoryPort,
    private readonly committer?: DocumentCommitPort,
  ) {
    this.writes = new SqliteGraphWrites(db);
  }

  async apply(
    changeSet: ChangeSet,
    repositoryRoot: string | null,
  ): Promise<{ revision: number; resolvedIds: Record<string, string> }> {
    const files = this.stageFiles(changeSet);
    const repo = this.repositoryFor(changeSet, files, repositoryRoot);
    // Never overwrite documents the user has changed and not committed (D6).
    const paths = files.map(file => file.relativePath);
    if (paths.length && this.committer && repositoryRoot) {
      const dirty = await this.committer.uncommitted(repositoryRoot, paths);
      if (dirty.length)
        throw new Error(
          `No se aplicó el cambio: ${dirty.join(', ')} tiene cambios sin commitear. Commitéalos o descártalos y vuelve a aplicar.`,
        );
    }
    const ids: Record<string, string> = {};
    const ctx: ApplyContext = {
      changeSet,
      revision: changeSet.baseGraphRevision + 1,
      now: new Date().toISOString(),
      repositoryId: repo?.id ?? null,
      ids,
      files,
      resolve: id => (id == null ? null : (ids[id] ?? id)),
    };
    await this.files.applyAtomically(repositoryRoot ?? '', files, () =>
      this.db.transaction(() => this.commitGraph(ctx)).immediate(),
    );
    // Commit the written documents so executions, which start from Git, see them (D6). A failure is reported at execution start.
    if (paths.length && this.committer && repositoryRoot)
      await this.committer.commit(repositoryRoot, paths, `docs(graph): ${changeSet.title} [changeset ${changeSet.id}]`);
    return { revision: ctx.revision, resolvedIds: ids };
  }

  /** The Markdown documents the ChangeSet writes; an artifact update must keep its path (no orphaned files). */
  private stageFiles(changeSet: ChangeSet): StagedMarkdownFile[] {
    const files: StagedMarkdownFile[] = [];
    for (const op of changeSet.operations) {
      if (op.type !== 'UPSERT_ARTIFACT' && op.type !== 'CREATE_DECISION_RECORD') continue;
      const replace = op.type === 'UPSERT_ARTIFACT' && !!op.entityId && !op.tempId;
      if (replace) {
        const existing = this.db
          .prepare(
            `SELECT relative_path FROM artifacts WHERE entity_id=? AND entity_id IN (SELECT id FROM knowledge_entities WHERE project_id=?)`,
          )
          .get(op.entityId, changeSet.projectId) as { relative_path: string } | undefined;
        if (!existing) throw new Error('El Artifact indicado no existe en el proyecto.');
        if (existing.relative_path !== op.relativePath)
          throw new Error('Un upsert de Artifact debe conservar su ruta para no dejar archivos huérfanos.');
      }
      files.push({
        relativePath: op.relativePath,
        content: op.type === 'UPSERT_ARTIFACT' ? op.markdownContent : decisionMarkdown(op),
        ...(replace ? { replaceExisting: true } : {}),
      });
    }
    return files;
  }

  /** Documents and code references (plan REP, R3) belong to the project's repository. */
  private repositoryFor(changeSet: ChangeSet, files: StagedMarkdownFile[], repositoryRoot: string | null) {
    if (files.length && !repositoryRoot)
      throw new Error('Configura el repositorio Git para aplicar cambios con documentos Markdown.');
    const needed = files.length > 0 || changeSet.operations.some(op => op.type === 'CREATE_CODE_REFERENCE');
    const repo = needed ? this.repositories.findPrimaryForProject(changeSet.projectId) : null;
    if (needed && !repo) throw new Error('No hay repositorio configurado para guardar los documentos.');
    return repo;
  }

  /** Inside the transaction: the revision check, the creations in dependency order, the rest, the index and the revision bump. */
  private commitGraph(ctx: ApplyContext): void {
    const { changeSet } = ctx;
    const row = this.db.prepare('SELECT current_revision FROM projects WHERE id=?').get(changeSet.projectId) as
      | { current_revision: number }
      | undefined;
    if (!row) throw new Error('Proyecto no encontrado.');
    if (row.current_revision !== changeSet.baseGraphRevision)
      throw new Error('REVISION_CONFLICT: el grafo cambió antes de aplicar.');
    this.insertCreates(ctx);
    for (const op of changeSet.operations) this.writes.applyOperation(op, ctx);
    this.writes.indexFiles(ctx);
    this.db
      .prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?')
      .run(ctx.revision, ctx.now, changeSet.projectId);
    this.db
      .prepare(`UPDATE change_sets SET status='APPLIED',applied_graph_revision=?,applied_at=? WHERE id=?`)
      .run(ctx.revision, ctx.now, changeSet.id);
  }

  /** Creations whose parent is another temporary ref wait until that one has its id (topological order). */
  private insertCreates(ctx: ApplyContext): void {
    let pending = ctx.changeSet.operations.filter(isCreate);
    while (pending.length) {
      const next: typeof pending = [];
      let progress = false;
      for (const op of pending) {
        const parent = parentOf(op);
        if (parent?.startsWith('$') && !ctx.ids[parent]) {
          next.push(op);
          continue;
        }
        this.writes.insertCreate(op, ctx);
        progress = true;
      }
      if (!progress) throw new Error('No se pudieron resolver las referencias temporales en orden topológico.');
      pending = next;
    }
  }
}
