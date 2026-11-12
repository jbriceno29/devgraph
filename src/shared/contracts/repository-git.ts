/** Plan GIT: how the app sees the project's repository, for Ajustes › Repositorio. */
export interface RepositoryGitStatusDto {
  /** Features start from this branch and integrate into it; documents are saved on it. */
  baseBranch: string;
  branches: string[];
  /** Branch checked out in the user's repository (null: detached, also during a rebase). */
  checkedOut: string | null;
  operation: 'MERGE' | 'REBASE' | 'CHERRY_PICK' | 'REVERT' | 'BISECT' | null;
  indexLocked: boolean;
  /** Without a git identity the app signs its commits as «Graph Workspace». */
  hasIdentity: boolean;
  /** Why documents cannot be saved right now (null: they can). */
  documentsBlocked: string | null;
}

export interface RepositoryGitChannels {
  'repository:git_status': (projectId: string) => Promise<RepositoryGitStatusDto>;
  'repository:set_base_branch': (projectId: string, branch: string) => Promise<RepositoryGitStatusDto>;
}

/** Optional so existing fakes stay valid; the Tauri client implements them. */
export interface RepositoryGitCommands {
  getRepositoryGitStatus?(projectId: string): Promise<RepositoryGitStatusDto>;
  setBaseBranch?(projectId: string, branch: string): Promise<RepositoryGitStatusDto>;
}
