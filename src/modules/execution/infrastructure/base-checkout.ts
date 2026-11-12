import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { activeCheckDirectories } from './feature-checks.js';
import { git } from './git-isolation-service.js';
import { resolveBaseBranch, withRepositoryLock } from './git-repository-state.js';

/**
 * A throwaway copy (detached worktree under `projects/<id>/checks/`) of the project's base branch, removed when `work`
 * ends. No branch moves and the user's checkout is never read: plan REP uses it for the baseline (R2) and the survey (R3).
 */
export async function withBaseCheckout<T>(
  input: { repositoryPath: string; configuredBase: string | null; workspaceRoot: string; projectId: string },
  work: (directory: string, at: { ref: string; commit: string }) => Promise<T>,
): Promise<T> {
  const root = await realpath(input.repositoryPath);
  const ref = await resolveBaseBranch(root, input.configuredBase);
  const directory = join(input.workspaceRoot, 'projects', input.projectId, 'checks', randomUUID());
  activeCheckDirectories.add(directory);
  try {
    const commit = await withRepositoryLock(root, async () => {
      const head = (await git(root, ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`])).trim();
      await mkdir(dirname(directory), { recursive: true });
      await git(root, ['worktree', 'add', '--quiet', '--detach', directory, head]);
      return head;
    });
    try {
      return await work(directory, { ref, commit });
    } finally {
      await withRepositoryLock(root, async () => {
        await git(root, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
        await git(root, ['worktree', 'prune']).catch(() => undefined);
      });
    }
  } finally {
    activeCheckDirectories.delete(directory);
  }
}

/** The files Git tracks in a checkout (paths with `/`), for checking that evidence exists. */
export async function trackedFiles(directory: string): Promise<string[]> {
  return (await git(directory, ['ls-files', '-z'])).split('\0').filter(Boolean);
}
