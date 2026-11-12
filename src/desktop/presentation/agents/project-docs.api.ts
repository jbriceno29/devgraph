import type { ProjectDocsDto, ProjectDocsInput } from '../../../shared/contracts/project-docs.js';

/** Plan C1: which documentation the project's agents may read. */
export const projectDocsApi = {
  available: () => Boolean(window.workspaceIpc.commands.getProjectDocs),
  get(projectId: string): Promise<ProjectDocsDto> {
    const command = window.workspaceIpc.commands.getProjectDocs;
    if (!command)
      return Promise.reject(new Error('Esta versión de la app no puede leer la documentación del proyecto.'));
    return command(projectId);
  },
  set(projectId: string, input: ProjectDocsInput): Promise<ProjectDocsDto> {
    const command = window.workspaceIpc.commands.setProjectDocs;
    if (!command)
      return Promise.reject(new Error('Esta versión de la app no puede cambiar la documentación del proyecto.'));
    return command(projectId, input);
  },
};
