import type { RepositoryGitStatusDto } from '../../../shared/contracts/repository-git.js';

/** Plan GIT: the project's base branch and the state of the user's checkout. */
export const repositoryGitApi = {
  available: () => Boolean(window.workspaceIpc.commands.getRepositoryGitStatus),
  status(projectId: string): Promise<RepositoryGitStatusDto> {
    const command = window.workspaceIpc.commands.getRepositoryGitStatus;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede leer el estado de Git.'));
    return command(projectId);
  },
  setBaseBranch(projectId: string, branch: string): Promise<RepositoryGitStatusDto> {
    const command = window.workspaceIpc.commands.setBaseBranch;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede cambiar la rama base.'));
    return command(projectId, branch);
  },
};
