import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { FeatureConflictGitPort } from '../application/ports/feature-conflict-port.js';
import { git } from './git-isolation-service.js';
import { readableGitError, withRepositoryLock } from './git-repository-state.js';

const execFileAsync = promisify(execFile);
const uuid = /^[a-f0-9-]{36}$/i;
const identity = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];
type MergeInput = {
  repositoryRoot: string;
  workspaceRoot: string;
  projectId: string;
  branch: string;
  sourceRef: string;
  message: string;
};
const markerPattern = '^(<<<<<<<|>>>>>>>)( |$)';

/** Conflicts between two branches without touching any checkout (`git merge-tree`), and the merge an agent resolves. */
export class GitFeatureConflicts implements FeatureConflictGitPort {
  async conflicts(repositoryRoot: string, ours: string, theirs: string): Promise<string[]> {
    try {
      await execFileAsync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs], {
        cwd: repositoryRoot,
      });
      return [];
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; message?: string };
      // Exit 1 means "merged with conflicts": the first line is the tree, the rest are the conflicted paths.
      if (failure.code !== 1) throw new Error(`No se pudo comparar ${ours} con ${theirs}: ${failure.message ?? ''}`);
      return [...new Set((failure.stdout ?? '').split('\n').slice(1).filter(Boolean))];
    }
  }

  async filesWithMarkers(repositoryRoot: string, branch: string, base: string): Promise<string[]> {
    const changed = (await git(repositoryRoot, ['diff', '--name-only', `${base}...${branch}`]))
      .split('\n')
      .filter(Boolean);
    if (!changed.length) return [];
    try {
      const { stdout } = await execFileAsync('git', ['grep', '-l', '-E', markerPattern, branch, '--', ...changed], {
        cwd: repositoryRoot,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout
        .split('\n')
        .filter(Boolean)
        .map(line => line.slice(branch.length + 1));
    } catch (error) {
      if ((error as { code?: number }).code === 1) return [];
      throw error;
    }
  }

  /**
   * Merges `sourceRef` into `branch` in a throwaway worktree and commits the result with its conflict markers, so a task
   * of the feature can resolve them like any other change. The branch only moves if nobody moved it meanwhile; it is
   * refused while the branch is checked out somewhere (that checkout would fall out of step).
   */
  async mergeWithConflicts(input: MergeInput): Promise<{ commit: string; conflicts: string[] }> {
    if (!uuid.test(input.projectId)) throw new Error('Invalid project id for merge.');
    const repositoryRoot = await realpath(input.repositoryRoot);
    // One app write at a time on this repository (plan GIT, G8), with readable git errors.
    return withRepositoryLock(repositoryRoot, () =>
      this.mergeLocked(input, repositoryRoot).catch(error => Promise.reject(readableGitError(error))),
    );
  }

  private async mergeLocked(
    input: MergeInput,
    repositoryRoot: string,
  ): Promise<{ commit: string; conflicts: string[] }> {
    const openIn = await checkedOutIn(repositoryRoot, input.branch);
    if (openIn)
      throw new Error(
        openIn === repositoryRoot
          ? `Tu repositorio (${openIn}) tiene abierta la rama ${input.branch}. Cambia a otra rama (por ejemplo, git checkout main) y vuelve a intentarlo: la app no mueve una rama que tienes abierta.`
          : `La rama ${input.branch} está abierta en ${openIn}. Cambia de rama allí y vuelve a intentarlo.`,
      );
    const before = (await git(repositoryRoot, ['rev-parse', '--verify', `refs/heads/${input.branch}^{commit}`])).trim();
    const directory = join(input.workspaceRoot, 'projects', input.projectId, 'merges', randomUUID());
    await mkdir(dirname(directory), { recursive: true });
    await git(repositoryRoot, ['worktree', 'add', '--quiet', '--detach', directory, before]);
    const run = (args: string[]) =>
      git(directory, ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${join(directory, '.no-hooks')}`, ...args]);
    try {
      await run([...identity, 'merge', '--no-ff', '--no-commit', '--quiet', input.sourceRef]).catch(() => undefined);
      const conflicts = (await run(['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
      if (!conflicts.length) throw new Error(`Al juntar ${input.sourceRef} en ${input.branch} no hubo conflictos.`);
      await run(['add', '-A']);
      await run([...identity, 'commit', '--no-verify', '--quiet', '-m', input.message]);
      const commit = (await run(['rev-parse', 'HEAD'])).trim();
      await git(repositoryRoot, ['update-ref', '-m', input.message, `refs/heads/${input.branch}`, commit, before]);
      return { commit, conflicts };
    } finally {
      await git(repositoryRoot, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
      await git(repositoryRoot, ['worktree', 'prune']).catch(() => undefined);
    }
  }
}

/** The folder where `branch` is checked out (the user's repository or another worktree), or null. */
async function checkedOutIn(repositoryRoot: string, branch: string): Promise<string | null> {
  let folder: string | null = null;
  for (const line of (await git(repositoryRoot, ['worktree', 'list', '--porcelain'])).split('\n')) {
    if (line.startsWith('worktree ')) folder = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}` && folder) return realpath(folder).catch(() => folder);
  }
  return null;
}
