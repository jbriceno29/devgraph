import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  branchExists,
  checkoutState,
  detectBaseBranch,
  documentsBlocker,
  localBranches,
  removeOrphanMergeWorktrees,
  resolveBaseBranch,
} from '../../modules/execution/index.js';
import type { RepositoryGitStatusDto } from '../../shared/contracts/repository-git.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { Container } from '../container.js';

const execFileAsync = promisify(execFile);

/** Plan GIT: the project's base branch and what the user's checkout is doing (Ajustes › Repositorio). */
export function repositoryGitHandlers(c: Container): IpcHandlers {
  return {
    'repository:git_status': ([raw]) => gitStatus(c, text(raw)),
    'repository:set_base_branch': serial(async ([raw, branch]) => {
      const projectId = text(raw);
      const root = await realpath(c.repositoryOf(projectId));
      const name = text(branch).trim();
      if (!(await branchExists(root, name))) throw new Error(`La rama ${name} no existe en el repositorio.`);
      c.store.openProject(projectId).repositories.setDefaultBranch(projectId, name);
      return gitStatus(c, projectId);
    }),
  };
}

async function gitStatus(c: Container, projectId: string): Promise<RepositoryGitStatusDto> {
  const root = await realpath(c.repositoryOf(projectId));
  const baseBranch = await resolveBaseBranch(root, c.baseBranch(projectId));
  const state = await checkoutState(root);
  const email = await execFileAsync('git', ['config', 'user.email'], { cwd: root }).then(
    result => result.stdout.trim(),
    () => '',
  );
  return {
    baseBranch,
    branches: await localBranches(root),
    checkedOut: state.branch,
    operation: state.operation,
    indexLocked: state.indexLocked,
    hasIdentity: Boolean(email),
    documentsBlocked: documentsBlocker(state, baseBranch),
  };
}

/**
 * When a repository is connected or a project opened: keep the base branch if it still exists, otherwise detect it
 * (remote default, main, master, the checked out branch), and remove merge worktrees a crash left behind (G9).
 */
export async function settleRepository(c: Container, projectId: string): Promise<void> {
  const path = c.repositoryPath(projectId);
  if (!path) return;
  const root = await realpath(path).catch(() => null);
  if (!root) return;
  const configured = c.baseBranch(projectId);
  if (!configured || !(await branchExists(root, configured))) {
    const detected = await detectBaseBranch(root);
    if (detected) c.store.openProject(projectId).repositories.setDefaultBranch(projectId, detected);
  }
  await removeOrphanMergeWorktrees(root, c.workspaceRoot, projectId).catch(() => 0);
}
