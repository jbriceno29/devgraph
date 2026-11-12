import { ArtifactManagementService } from '../../modules/documents/application/artifact-management-service.js';
import type { ArtifactSyncStatusChangedEvent } from '../../modules/documents/application/ports/artifact-management-port.js';
import { ArtifactWatcherService } from '../../modules/documents/infrastructure/artifact-watcher-service.js';
import { TransactionalMarkdownFileStore } from '../../modules/documents/infrastructure/transactional-markdown-file-store.js';
import type { Container } from '../container.js';

/** Markdown documents of the repository: management, recovery of interrupted writes and the watcher of docs/. */
export function documentServices(c: Container) {
  const watchers = new Map<string, ArtifactWatcherService>();
  const management = (projectId: string) => {
    const workspace = c.store.openProject(projectId);
    return new ArtifactManagementService(
      workspace.projects,
      workspace.graph,
      workspace.artifacts,
      workspace.repositories,
      c.files,
      event => c.emit('artifact:sync_status_changed', event as ArtifactSyncStatusChangedEvent),
      c.documentCommitter,
    );
  };
  return {
    management,
    managementForDocument: (documentId: string) => {
      for (const project of c.store.listProjects())
        if (c.store.openProject(project.id).artifacts.findDocumentById(documentId)) return management(project.id);
      throw new Error(`Document not found: ${documentId}`);
    },
    // Repairs leftovers of an interrupted ChangeSet apply before the watcher starts reporting on docs/.
    recoverDocuments: async (projectId: string) => {
      const documents = management(projectId),
        root = documents.repositoryPath(projectId);
      if (!root) return;
      const known = new Map(documents.list(projectId).map(document => [document.relativePath, document.contentHash]));
      await new TransactionalMarkdownFileStore().recoverInterruptedWrites(root, known).catch(() => undefined);
    },
    startWatcher: async (projectId: string) => {
      const documents = management(projectId),
        repositoryPath = documents.repositoryPath(projectId);
      watchers.get(projectId)?.stop();
      watchers.delete(projectId);
      if (!repositoryPath) return;
      const watcher = new ArtifactWatcherService(projectId, repositoryPath, c.files, documents);
      await watcher.start();
      watchers.set(projectId, watcher);
    },
    close: () => {
      for (const watcher of watchers.values()) watcher.stop();
      watchers.clear();
    },
  };
}
