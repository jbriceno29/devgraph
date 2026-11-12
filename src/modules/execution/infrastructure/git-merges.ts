import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type BaseMergeResult, type SquashMergeResult, checkedOutPath, git } from './git-isolation-service.js';

const uuid = /^[a-f0-9-]{36}$/i;
const DEFAULT_IDENTITY = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];

export interface MergeInput {
  repositoryRoot: string;
  workspaceRoot: string;
  projectId: string;
  targetBranch: string;
  sourceRef: string;
  message: string;
}
type Run = (args: string[]) => Promise<string>;
type Failure = { ok: false; reason: 'CONFLICT'; detail: string; conflicts: string[] };

/**
 * Runs `work` in a throwaway worktree of `ref` under the project's `merges/` (hooks and fsmonitor off), and always
 * removes it afterwards. `detach` checks out the commit instead of the branch.
 */
async function inThrowawayWorktree<T>(
  repositoryRoot: string,
  input: Pick<MergeInput, 'workspaceRoot' | 'projectId'>,
  ref: string,
  detach: boolean,
  work: (run: Run) => Promise<T>,
): Promise<T> {
  const directory = join(input.workspaceRoot, 'projects', input.projectId, 'merges', randomUUID());
  await mkdir(dirname(directory), { recursive: true });
  await git(repositoryRoot, ['worktree', 'add', '--quiet', ...(detach ? ['--detach'] : []), directory, ref]);
  const run: Run = args =>
    git(directory, [
      '-c',
      'core.fsmonitor=false',
      '-c',
      `core.hooksPath=${join(directory, '.graphdev-no-hooks')}`,
      ...args,
    ]);
  try {
    return await work(run);
  } finally {
    await git(repositoryRoot, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    await git(repositoryRoot, ['worktree', 'prune']).catch(() => undefined);
  }
}

/** The repository's identity when it has one; otherwise the app signs as «Graph Workspace». */
const identityOf = (run: Run) =>
  run(['config', 'user.email']).then(
    value => (value.trim() ? [] : DEFAULT_IDENTITY),
    () => DEFAULT_IDENTITY,
  );

/** A failed merge: the conflicted files, or the git error when there are none. */
async function conflictOf(run: Run, error: unknown, conflictText: string, failureText: string): Promise<Failure> {
  const conflicts = (await run(['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
  return {
    ok: false,
    reason: 'CONFLICT',
    detail: conflicts.length
      ? conflictText
      : `${failureText}: ${error instanceof Error ? error.message : String(error)}`,
    conflicts,
  };
}

const rev = async (repositoryRoot: string, ref: string) =>
  (await git(repositoryRoot, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();

/**
 * Integrates a feature into the project's base branch with a merge commit made in a detached throwaway worktree, then
 * moves the base branch: with `--ff-only` in the user's checkout (only when it is clean) or with `update-ref` and
 * compare-and-swap elsewhere. Refused when the branch is open in another folder or the user's checkout is dirty.
 */
export async function mergeIntoBase(input: MergeInput, isAncestor: (a: string, b: string) => Promise<boolean>) {
  if (!uuid.test(input.projectId)) throw new Error('Invalid project id for merge.');
  const repositoryRoot = await realpath(input.repositoryRoot);
  const sourceCommit = await rev(repositoryRoot, input.sourceRef);
  const targetCommit = await rev(repositoryRoot, `refs/heads/${input.targetBranch}`);
  if (await isAncestor(sourceCommit, targetCommit)) return { ok: true as const, commit: targetCommit, changed: false };
  const checkout = await baseCheckout(repositoryRoot, input.targetBranch);
  if ('blocked' in checkout) return checkout.blocked;
  const merged = await inThrowawayWorktree(repositoryRoot, input, targetCommit, true, async run => {
    try {
      await run([
        ...(await identityOf(run)),
        'merge',
        '--no-ff',
        '--no-verify',
        '--quiet',
        '-m',
        input.message,
        sourceCommit,
      ]);
    } catch (error) {
      return conflictOf(
        run,
        error,
        `Conflicto al integrar en ${input.targetBranch}.`,
        `No se pudo integrar en ${input.targetBranch}`,
      );
    }
    return (await run(['rev-parse', 'HEAD'])).trim();
  });
  if (typeof merged !== 'string') return merged;
  return advanceBase(repositoryRoot, input, merged, targetCommit, checkout.inUserCheckout);
}

/** Whether the base branch is checked out in the user's folder (it must be clean) or elsewhere (refused). */
async function baseCheckout(
  repositoryRoot: string,
  targetBranch: string,
): Promise<{ inUserCheckout: boolean } | { blocked: BaseMergeResult }> {
  const checkedOut = checkedOutPath(await git(repositoryRoot, ['worktree', 'list', '--porcelain']), targetBranch);
  const inUserCheckout =
    checkedOut !== null &&
    (await realpath(checkedOut).then(
      path => path === repositoryRoot,
      () => false,
    ));
  if (checkedOut && !inUserCheckout)
    return {
      blocked: {
        ok: false,
        reason: 'CHECKED_OUT',
        detail: `La rama ${targetBranch} está abierta en ${checkedOut}. Cambia de rama allí para poder integrar.`,
        conflicts: [],
      },
    };
  if (!inUserCheckout) return { inUserCheckout };
  const dirty = (await git(repositoryRoot, ['status', '--porcelain', '--untracked-files=no']))
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3));
  if (!dirty.length) return { inUserCheckout };
  return {
    blocked: {
      ok: false,
      reason: 'DIRTY',
      detail: `Tu repositorio está en ${targetBranch} con cambios sin commitear; commitéalos o guárdalos (git stash) y vuelve a integrar.`,
      conflicts: dirty,
    },
  };
}

/** --ff-only cannot conflict and refuses to overwrite local files; update-ref only moves the branch if nobody else did. */
async function advanceBase(
  repositoryRoot: string,
  input: MergeInput,
  merged: string,
  targetCommit: string,
  inUserCheckout: boolean,
): Promise<BaseMergeResult> {
  try {
    if (inUserCheckout)
      await git(repositoryRoot, [
        '-c',
        `core.hooksPath=${join(input.workspaceRoot, '.graphdev-no-hooks')}`,
        'merge',
        '--ff-only',
        '--quiet',
        merged,
      ]);
    else
      await git(repositoryRoot, [
        'update-ref',
        '-m',
        input.message,
        `refs/heads/${input.targetBranch}`,
        merged,
        targetCommit,
      ]);
  } catch (error) {
    return {
      ok: false,
      reason: 'DIRTY',
      detail: `No se pudo avanzar ${input.targetBranch} sin tocar tus archivos: ${error instanceof Error ? error.message : String(error)}`,
      conflicts: [],
    };
  }
  return { ok: true, commit: merged, changed: true };
}

/**
 * Squash-merges (`squash`, accepting a run) or merges (`merge`, bringing a feature up to date) `sourceRef` into
 * `targetBranch` in a throwaway worktree. Refused while the target is checked out anywhere.
 */
export async function integrateInto(input: MergeInput, mode: 'squash' | 'merge'): Promise<SquashMergeResult> {
  if (!uuid.test(input.projectId)) throw new Error('Invalid project id for merge.');
  const repositoryRoot = await realpath(input.repositoryRoot);
  // Resolve the source in the user's repository: inside the throwaway worktree, HEAD would be the target itself.
  const sourceCommit = await rev(repositoryRoot, input.sourceRef);
  const checkedOut = checkedOutPath(await git(repositoryRoot, ['worktree', 'list', '--porcelain']), input.targetBranch);
  if (checkedOut)
    return {
      ok: false,
      reason: 'CHECKED_OUT',
      detail: `La rama ${input.targetBranch} está abierta en ${checkedOut}. Cambia de rama allí para poder integrar.`,
      conflicts: [],
    };
  return inThrowawayWorktree(repositoryRoot, input, input.targetBranch, false, run =>
    mode === 'merge' ? mergeCommit(run, input, sourceCommit) : squashCommit(run, input, sourceCommit),
  );
}

async function mergeCommit(run: Run, input: MergeInput, sourceCommit: string): Promise<SquashMergeResult> {
  try {
    await run([
      ...(await identityOf(run)),
      'merge',
      '--no-ff',
      '--no-verify',
      '--quiet',
      '-m',
      input.message,
      sourceCommit,
    ]);
  } catch (error) {
    return conflictOf(
      run,
      error,
      `Conflicto al poner al día ${input.targetBranch}.`,
      `No se pudo poner al día ${input.targetBranch}`,
    );
  }
  return { ok: true, commit: (await run(['rev-parse', 'HEAD'])).trim(), changed: true };
}

async function squashCommit(run: Run, input: MergeInput, sourceCommit: string): Promise<SquashMergeResult> {
  try {
    await run(['merge', '--squash', '--no-commit', sourceCommit]);
  } catch (error) {
    return conflictOf(
      run,
      error,
      `Conflicto al integrar en ${input.targetBranch}.`,
      `No se pudo integrar en ${input.targetBranch}`,
    );
  }
  const staged = await run(['diff', '--cached', '--quiet']).then(
    () => false,
    () => true,
  );
  if (staged) await run([...(await identityOf(run)), 'commit', '--no-verify', '--quiet', '-m', input.message]);
  return { ok: true, commit: (await run(['rev-parse', 'HEAD'])).trim(), changed: staged };
}
