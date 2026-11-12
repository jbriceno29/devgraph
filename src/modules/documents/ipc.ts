import type {
  ArtifactDocumentDto,
  ArtifactDocumentViewDto,
  CreateArtifactDocumentInput,
} from '../../shared/contracts/artifact-view.js';
import { text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { ArtifactManagementService, DocumentView } from './application/artifact-management-service.js';
import type { ArtifactDocumentRecord } from './application/ports/artifact-management-port.js';

export interface DocumentsIpcDeps {
  management(projectId: string): ArtifactManagementService;
  managementForDocument(documentId: string): ArtifactManagementService;
  currentRevision(projectId: string): number;
  emit(channel: string, payload: unknown): void;
}

/** The project's Markdown documents in its repository. */
export function documentsHandlers(d: DocumentsIpcDeps): IpcHandlers {
  return {
    'repository:get_path': ([id]) => d.management(text(id)).repositoryPath(text(id)),
    'artifact:list': ([id]) => d.management(text(id)).list(text(id)).map(toDocumentDto),
    'artifact:read': async ([id]) => toDocumentViewDto(await d.managementForDocument(text(id)).read(text(id))),
    'artifact:create': async ([raw]) => {
      const input = raw as CreateArtifactDocumentInput;
      const result = await d.management(input.projectId).create(input);
      d.emit('graph:revision_updated', { projectId: input.projectId, revision: d.currentRevision(input.projectId) });
      return toDocumentViewDto(result);
    },
    'artifact:save': async ([id, hash, content]) =>
      toDocumentViewDto(await d.managementForDocument(text(id)).save(text(id), text(hash), text(content))),
  };
}

function toDocumentDto(document: ArtifactDocumentRecord): ArtifactDocumentDto {
  return {
    id: document.id,
    projectId: document.projectId,
    displayKey: document.displayKey,
    title: document.title,
    summary: document.summary,
    entityType: document.entityType,
    artifactType: document.artifactType,
    version: document.version,
    adrNumber: document.adrNumber,
    relativePath: document.relativePath,
    contentHash: document.contentHash,
    syncStatus: document.syncStatus,
  };
}
function toDocumentViewDto(view: DocumentView): ArtifactDocumentViewDto {
  return { document: toDocumentDto(view.document), content: view.content };
}
