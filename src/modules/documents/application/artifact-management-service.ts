import type { DocumentCommitPort } from './ports/document-commit-port.js';
import type { ProjectRepositoryPort } from '../../projects/index.js';
import type {
  ArtifactRepositoryPort,
  ArtifactDocumentRecord,
  RepositoryLocationRepositoryPort,
  AtomicMarkdownFilePort,
  ArtifactSyncStatusChangedEvent,
} from './ports/artifact-management-port.js';
import type { KnowledgeGraphRepositoryPort } from '../../knowledge/index.js';
import type { GraphRelationship, KnowledgeEntity } from '../../knowledge/index.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../../shared/contracts/graph-view.js';
import { GraphTopologyService } from '../../knowledge/index.js';
import {
  artifactPath,
  createArtifactTemplate,
  createDecisionRecordTemplate,
  decisionRecordPath,
  nextDocumentNumber,
  parseDecisionRecord,
  type SupportedArtifactType,
} from './artifact-templates.js';

export type ArtifactManagementEventListener = (event: ArtifactSyncStatusChangedEvent) => void;
export interface DocumentView {
  document: ArtifactDocumentRecord;
  content: string;
}
export interface CreateDocumentInput {
  projectId: string;
  entityType: 'ARTIFACT' | 'DECISION_RECORD';
  title: string;
  artifactType?: SupportedArtifactType;
  targetEntityId: string;
}

export class ArtifactManagementService {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly graph: KnowledgeGraphRepositoryPort,
    private readonly documents: ArtifactRepositoryPort,
    private readonly repositories: RepositoryLocationRepositoryPort,
    private readonly files: AtomicMarkdownFilePort,
    private readonly onSyncEvent: ArtifactManagementEventListener = () => undefined,
    private readonly committer?: DocumentCommitPort,
  ) {}

  async configureRepository(projectId: string, path: string): Promise<{ projectId: string; localPath: string }> {
    this.requireProject(projectId);
    const root = await this.files.resolveGitRepository(path);
    await this.files.ensureDocsDirectory(root);
    this.repositories.setPrimary(projectId, root);
    return { projectId, localPath: root };
  }

  repositoryPath(projectId: string): string | null {
    this.requireProject(projectId);
    return this.repositories.findPrimaryForProject(projectId)?.localPath ?? null;
  }

  list(projectId: string): ArtifactDocumentRecord[] {
    this.requireProject(projectId);
    return this.documents.listDocuments(projectId);
  }

  async read(documentId: string): Promise<DocumentView> {
    const document = this.requireDocument(documentId);
    const location = this.requireRepository(document.projectId);
    try {
      const file = await this.files.readMarkdown(location.localPath, document.relativePath);
      if (file.contentHash !== document.contentHash || document.syncStatus === 'MISSING') {
        this.documents.updateDocumentContent(document.id, file.contentHash, 'DRIFTED', file.content);
        this.emit(document, 'DRIFTED');
      }
      return { document: this.requireDocument(documentId), content: file.content };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (document.syncStatus !== 'MISSING') {
          this.documents.updateDocumentContent(document.id, document.contentHash, 'MISSING', '');
          this.emit(document, 'MISSING');
        }
        throw new Error(`El archivo ${document.relativePath} no existe en el repositorio.`);
      }
      throw error;
    }
  }

  async create(input: CreateDocumentInput): Promise<DocumentView> {
    const project = this.requireProject(input.projectId);
    const location = this.requireRepository(input.projectId);
    const title = input.title.trim();
    if (!title) throw new Error('El título del documento es obligatorio.');
    const target = this.graph.findEntityById(input.targetEntityId);
    if (!target || target.projectId !== input.projectId)
      throw new Error('Selecciona una entidad del proyecto para vincular el documento.');
    const existingEntities = this.graph.listEntities(input.projectId);
    const existingEdges = this.graph.listRelationships(input.projectId);
    const now = new Date().toISOString();
    const revision = project.currentRevision + 1;
    const entityId = globalThis.crypto.randomUUID();
    const records = this.documents.listDocuments(input.projectId);
    let relativePath: string, content: string, displayKey: string, link: GraphRelationship;
    const type = input.entityType as KnowledgeEntityType;
    if (input.entityType === 'ARTIFACT') {
      const artifactType = input.artifactType ?? 'OTHER';
      relativePath = artifactPath(artifactType, title);
      content = createArtifactTemplate(artifactType, title);
      displayKey = `DOC-${String(nextDocumentNumber(records, 'DOC')).padStart(3, '0')}`;
      link = this.createLink(target.id, entityId, input.projectId, 'DOCUMENTED_BY', revision, now);
    } else {
      const adrNumber = nextDocumentNumber(records, 'ADR');
      relativePath = decisionRecordPath(adrNumber);
      content = createDecisionRecordTemplate(adrNumber, title);
      displayKey = `ADR-${String(adrNumber).padStart(3, '0')}`;
      link = this.createLink(entityId, target.id, input.projectId, 'AFFECTS', revision, now);
    }
    if (
      this.documents.findDocumentByPath(input.projectId, relativePath) ||
      (await this.files.markdownExists(location.localPath, relativePath))
    )
      throw new Error(`Ya existe un documento en ${relativePath}.`);
    const entity: KnowledgeEntity = {
      id: entityId,
      projectId: input.projectId,
      entityType: type,
      displayKey,
      title,
      summary: '',
      status: 'DRAFT',
      parentId: null,
      createdRevision: revision,
      updatedRevision: revision,
      createdAt: now,
      updatedAt: now,
    };
    const topology = new GraphTopologyService();
    const relationshipSource = existingEntities.find(e => e.id === link.sourceId) ?? entity;
    const relationshipTarget = existingEntities.find(e => e.id === link.targetId) ?? entity;
    topology.validateParent(entity, null, existingEntities);
    topology.validateEdge(relationshipSource, relationshipTarget, link.edgeType, existingEdges);
    const written = await this.write(location.localPath, relativePath, content);
    try {
      if (input.entityType === 'ARTIFACT') {
        this.documents.createArtifact({
          entity,
          relativePath,
          contentHash: written.contentHash,
          bodyContent: content,
          artifactType: input.artifactType ?? 'OTHER',
          repositoryId: location.id,
          version: 1,
          link,
        });
      } else {
        const adrNumber = nextDocumentNumber(records, 'ADR');
        this.documents.createDecisionRecord({
          entity,
          relativePath,
          contentHash: written.contentHash,
          bodyContent: content,
          repositoryId: location.id,
          adrNumber,
          contextMd: 'Describe el problema y las fuerzas que motivan esta decisión.',
          alternativesMd: 'Alternativa: ventajas y desventajas.',
          decisionMd: 'Describe la decisión tomada.',
          consequencesMd: 'Consecuencias positivas y negativas.',
          decidedAt: now,
          link,
        });
      }
    } catch (error) {
      await this.files.removeMarkdown(location.localPath, relativePath).catch(() => undefined);
      throw error;
    }
    await this.committer?.commit(location.localPath, [relativePath], `docs(graph): ${displayKey} ${title}`);
    return { document: this.requireDocument(entityId), content };
  }

  async save(documentId: string, expectedContentHash: string, content: string): Promise<DocumentView> {
    const document = this.requireDocument(documentId);
    const location = this.requireRepository(document.projectId);
    const current = await this.files.readMarkdown(location.localPath, document.relativePath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (current && current.contentHash !== expectedContentHash) {
      this.documents.updateDocumentContent(document.id, current.contentHash, 'DRIFTED', current.content);
      this.emit(document, 'DRIFTED');
      throw new Error('El archivo cambió fuera del editor. Vuelve a cargarlo antes de guardar tus cambios.');
    }
    const written = await this.write(location.localPath, document.relativePath, content);
    const adrFields = document.entityType === 'DECISION_RECORD' ? parseDecisionRecord(content) : undefined;
    this.documents.updateDocumentContent(document.id, written.contentHash, 'SYNCED', content, adrFields ?? undefined);
    const updated = this.requireDocument(documentId);
    await this.committer?.commit(
      location.localPath,
      [document.relativePath],
      `docs(graph): ${updated.displayKey} ${updated.title}`,
    );
    this.emit(updated, 'SYNCED');
    return { document: updated, content };
  }

  reconcileExternalChange(projectId: string, relativePath: string | null): void {
    const candidates = relativePath
      ? this.documents.listDocuments(projectId).filter(document => document.relativePath === relativePath)
      : this.documents.listDocuments(projectId);
    const location = this.repositories.findPrimaryForProject(projectId);
    if (!location) return;
    // A late file event after the workspace closed (shutdown, tests) has nothing left to update.
    for (const document of candidates) void this.reconcile(document, location.localPath).catch(() => undefined);
  }

  /** The app writes documents only on the base branch, with no git operation half done (plan GIT, G3). */
  private async write(root: string, relativePath: string, content: string) {
    const blocked = await this.committer?.blocker(root);
    if (blocked) throw new Error(blocked);
    return this.files.writeMarkdownAtomically(root, relativePath, content);
  }

  private async reconcile(document: ArtifactDocumentRecord, root: string): Promise<void> {
    // On another branch (or mid-rebase) the files are not the project's documents: nothing drifted (plan GIT, G12).
    if (await this.committer?.blocker(root).catch(() => 'unknown')) return;
    try {
      const file = await this.files.readMarkdown(root, document.relativePath);
      if (file.contentHash !== document.contentHash) {
        this.documents.updateDocumentContent(document.id, file.contentHash, 'DRIFTED', file.content);
        this.emit(document, 'DRIFTED');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && document.syncStatus !== 'MISSING') {
        this.documents.updateDocumentContent(document.id, document.contentHash, 'MISSING', '');
        this.emit(document, 'MISSING');
      }
    }
  }

  private createLink(
    sourceId: string,
    targetId: string,
    projectId: string,
    edgeType: GraphEdgeType,
    revision: number,
    createdAt: string,
  ): GraphRelationship {
    return {
      id: globalThis.crypto.randomUUID(),
      projectId,
      sourceId,
      targetId,
      edgeType,
      provenance: 'USER',
      createdRevision: revision,
      createdAt,
    };
  }
  private requireProject(id: string) {
    const project = this.projects.findById(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  }
  private requireDocument(id: string): ArtifactDocumentRecord {
    const document = this.documents.findDocumentById(id);
    if (!document) throw new Error(`Document not found: ${id}`);
    return document;
  }
  private requireRepository(projectId: string) {
    const location = this.repositories.findPrimaryForProject(projectId);
    if (!location) throw new Error('Configura primero la ruta de un repositorio Git para este proyecto.');
    return location;
  }
  private emit(document: ArtifactDocumentRecord, syncStatus: ArtifactDocumentRecord['syncStatus']): void {
    this.onSyncEvent({
      projectId: document.projectId,
      documentId: document.id,
      relativePath: document.relativePath,
      syncStatus,
    });
  }
}
