import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GitIsolationPort } from '../application/ports/agent-execution-port.js';
import { git, GitIsolationService } from './git-isolation-service.js';
import { checkoutState, readableGitError, resolveBaseBranch, withRepositoryLock } from './git-repository-state.js';

const uuid = /^[a-f0-9-]{36}$/i;
const identity = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];
type Isolation = GitIsolationService;

/**
 * The isolation the app runs with (plan GIT): every feature starts from and integrates into the project's base branch
 * (never what the user has checked out), the app's writes on a repository go one at a time, and git errors a user can
 * cause (a busy repository, a branch open elsewhere) come back readable.
 */
export class SafeGitIsolation extends GitIsolationService implements GitIsolationPort {
  constructor(private readonly configuredBase: () => string | null) {
    super();
  }

  override async baseBranch(repositoryRoot: string): Promise<string> {
    return resolveBaseBranch(await realpath(repositoryRoot), this.configuredBase());
  }

  /** Uncommitted documents only matter when the checkout is on the base branch: another branch is the user's business. */
  override async uncommittedPaths(repositoryRoot: string, paths: string[]): Promise<string[]> {
    const root = await realpath(repositoryRoot);
    if ((await checkoutState(root)).branch !== (await this.baseBranch(root))) return [];
    return super.uncommittedPaths(root, paths);
  }

  override prepare(input: Parameters<Isolation['prepare']>[0]) {
    return this.locked(input.repositoryRoot, () => super.prepare(input));
  }
  override discard(input: Parameters<Isolation['discard']>[0]) {
    return this.locked(input.repositoryRoot, () => super.discard(input));
  }
  override createIntegrationBranch(input: Parameters<Isolation['createIntegrationBranch']>[0]) {
    return this.locked(input.repositoryRoot, () => super.createIntegrationBranch(input));
  }
  override deleteIntegrationBranch(repositoryRoot: string, branchName: string) {
    return this.locked(repositoryRoot, () => super.deleteIntegrationBranch(repositoryRoot, branchName));
  }
  override squashMerge(input: Parameters<Isolation['squashMerge']>[0]) {
    return this.locked(input.repositoryRoot, () => super.squashMerge(input));
  }
  override mergeInto(input: Parameters<Isolation['mergeInto']>[0]) {
    return this.locked(input.repositoryRoot, () => super.mergeInto(input));
  }
  override mergeIntoBase(input: Parameters<Isolation['mergeIntoBase']>[0]) {
    return this.locked(input.repositoryRoot, () => super.mergeIntoBase(input));
  }

  /** Copies only `paths` from `sourceRef` into `targetBranch` (a path missing in the source is removed), in one commit. */
  async copyPaths(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    targetBranch: string;
    sourceRef: string;
    paths: string[];
    message: string;
  }): Promise<{ ok: true; commit: string; changed: boolean } | { ok: false; reason: 'CHECKED_OUT'; detail: string }> {
    if (!uuid.test(input.projectId)) throw new Error('Invalid project id for merge.');
    return this.locked(input.repositoryRoot, async () => {
      const root = await realpath(input.repositoryRoot);
      const open = (await git(root, ['worktree', 'list', '--porcelain']))
        .split('\n')
        .includes(`branch refs/heads/${input.targetBranch}`);
      if (open)
        return {
          ok: false as const,
          reason: 'CHECKED_OUT' as const,
          detail: `La rama ${input.targetBranch} está abierta en una carpeta; cambia de rama allí para poder actualizarla.`,
        };
      const directory = join(input.workspaceRoot, 'projects', input.projectId, 'merges', randomUUID());
      await mkdir(dirname(directory), { recursive: true });
      await git(root, ['worktree', 'add', '--quiet', directory, input.targetBranch]);
      const run = (args: string[]) =>
        git(directory, ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${join(directory, '.no-hooks')}`, ...args]);
      try {
        for (const path of input.paths) {
          const inSource = await run(['cat-file', '-e', `${input.sourceRef}:${path}`]).then(
            () => true,
            () => false,
          );
          if (inSource) await run(['--literal-pathspecs', 'checkout', input.sourceRef, '--', path]);
          else await run(['--literal-pathspecs', 'rm', '--quiet', '--ignore-unmatch', '--', path]);
        }
        const changed = await run(['diff', '--cached', '--quiet']).then(
          () => false,
          () => true,
        );
        if (changed) await run([...identity, 'commit', '--no-verify', '--quiet', '-m', input.message]);
        return { ok: true as const, commit: (await run(['rev-parse', 'HEAD'])).trim(), changed };
      } finally {
        await git(root, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
        await git(root, ['worktree', 'prune']).catch(() => undefined);
      }
    });
  }

  private async locked<T>(repositoryRoot: string, work: () => Promise<T>): Promise<T> {
    const root = await realpath(repositoryRoot).catch(() => repositoryRoot);
    return withRepositoryLock(root, () => work().catch(error => Promise.reject(readableGitError(error))));
  }
}

/**
 * Removes the throwaway worktrees of merges a crash left behind (G9): only folders under the project's `merges/` in the
 * app's data, never the run worktrees (those are kept for review). Returns how many were removed.
 */
export async function removeOrphanMergeWorktrees(
  repositoryRoot: string,
  workspaceRoot: string,
  projectId: string,
): Promise<number> {
  if (!uuid.test(projectId)) return 0;
  const merges = join(workspaceRoot, 'projects', projectId, 'merges');
  const root = await realpath(repositoryRoot);
  // Read inside the lock: a merge of this process finishes (and removes its folder) before the scan.
  return withRepositoryLock(root, async () => {
    const orphans = (await readdir(merges).catch(() => [] as string[])).filter(entry => uuid.test(entry));
    if (!orphans.length) return 0;
    for (const entry of orphans) {
      await git(root, ['worktree', 'remove', '--force', join(merges, entry)]).catch(() => undefined);
      await rm(join(merges, entry), { recursive: true, force: true });
    }
    await git(root, ['worktree', 'prune']).catch(() => undefined);
    return orphans.length;
  });
}
