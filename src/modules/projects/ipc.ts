import type { ProjectSummaryDto } from '../../shared/contracts/ipc-contracts.js';
import { summarizeScan } from '../../shared/contracts/repository-scan.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { RepositoryScannerPort } from './application/ports/repository-scan-port.js';
import { proposeAgentAccess } from './domain/agent-access.js';
import type { Project } from './domain/project.js';
import { inspectFolder, type AppSettingsStore } from './infrastructure/project-folders.js';

export interface ProjectsIpcDeps {
  settings: Pick<AppSettingsStore, 'get' | 'setProjectsFolder'>;
  scanner: RepositoryScannerPort;
  repositoryPath(projectId: string): string | null;
}

/** App settings, folders and what the project's repository holds (no project data is written here). */
export function projectsHandlers(d: ProjectsIpcDeps): IpcHandlers {
  const scanOf = async (projectId: string) => {
    const path = d.repositoryPath(projectId);
    if (!path) throw new Error('El proyecto no tiene un repositorio configurado.');
    return d.scanner.scan(path);
  };
  return {
    'settings:get': () => d.settings.get(),
    'settings:set_projects_folder': serial(([path]) => d.settings.setProjectsFolder(text(path))),
    'folder:inspect': ([path]) => inspectFolder(text(path)),
    // Brownfield preview: what the assistant would read from the project's repository (no contents in the answer).
    'repository:scan': async ([projectId]) => summarizeScan(await scanOf(text(projectId))),
    // Plan REP R1: writable paths and checks read from the repository (nothing is saved).
    'policy:propose_from_repository': async ([projectId]) => {
      const scan = await scanOf(text(projectId));
      const manifest = scan.files.find(file => file.path === 'package.json' && file.kind === 'MANIFEST');
      return proposeAgentAccess({ topLevel: scan.topLevel, packageJson: manifest?.content ?? null });
    },
  };
}

export function toProjectSummary(project: Project): ProjectSummaryDto {
  return {
    id: project.props.id,
    name: project.props.name,
    slug: project.props.slug,
    description: project.props.description ?? null,
    currentRevision: project.currentRevision,
    createdAt: project.props.createdAt,
    updatedAt: project.props.updatedAt,
  };
}
