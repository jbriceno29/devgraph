import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const gitOut = async (cwd: string, args: string[]) => (await execFileAsync('git', args, { cwd })).stdout.trim();
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

export type GitOperation = 'MERGE' | 'REBASE' | 'CHERRY_PICK' | 'REVERT' | 'BISECT';

/** What the user's checkout is doing right now (plan GIT, G7). */
export interface CheckoutState {
  /** Branch checked out in the user's repository; null when HEAD is detached (also during a rebase). */
  branch: string | null;
  operation: GitOperation | null;
  /** Another git process holds the checkout's index (`index.lock`). */
  indexLocked: boolean;
}

const markers: Array<[string, GitOperation]> = [
  ['MERGE_HEAD', 'MERGE'],
  ['rebase-merge', 'REBASE'],
  ['rebase-apply', 'REBASE'],
  ['CHERRY_PICK_HEAD', 'CHERRY_PICK'],
  ['REVERT_HEAD', 'REVERT'],
  ['BISECT_LOG', 'BISECT'],
];

async function gitPath(root: string, name: string): Promise<string> {
  const path = await gitOut(root, ['rev-parse', '--git-path', name]);
  return isAbsolute(path) ? path : join(root, path);
}

export async function checkoutState(root: string): Promise<CheckoutState> {
  const branch = await gitOut(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '');
  let operation: GitOperation | null = null;
  for (const [name, kind] of markers)
    if (await exists(await gitPath(root, name))) {
      operation = kind;
      break;
    }
  return { branch: branch || null, operation, indexLocked: await exists(await gitPath(root, 'index.lock')) };
}

export async function branchExists(root: string, branch: string): Promise<boolean> {
  return gitOut(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );
}

export async function localBranches(root: string): Promise<string[]> {
  const out = await gitOut(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).catch(() => '');
  return out.split('\n').filter(Boolean).sort();
}

/**
 * The branch a project integrates into when none was chosen: the remote's default (`origin/HEAD`), else `main`, else
 * `master`, else the branch checked out now. Null in a repository without branches.
 */
export async function detectBaseBranch(root: string): Promise<string | null> {
  const remote = await gitOut(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
  const candidates = [remote.replace(/^origin\//, ''), 'main', 'master'].filter(Boolean);
  for (const candidate of candidates) if (await branchExists(root, candidate)) return candidate;
  return (await checkoutState(root)).branch;
}

/** The configured base branch when it exists; otherwise the detected one. Throws when the repository has no branch. */
export async function resolveBaseBranch(root: string, configured: string | null): Promise<string> {
  if (configured && (await branchExists(root, configured))) return configured;
  const detected = await detectBaseBranch(root);
  if (!detected)
    throw new Error(
      configured
        ? `La rama base ${configured} ya no existe y el repositorio no tiene otra. Crea una rama o elige otra en Ajustes.`
        : 'El repositorio no tiene ninguna rama todavía. Haz un primer commit para empezar.',
    );
  return detected;
}

const operationNames: Record<GitOperation, string> = {
  MERGE: 'un merge',
  REBASE: 'un rebase',
  CHERRY_PICK: 'un cherry-pick',
  REVERT: 'un revert',
  BISECT: 'un bisect',
};

/**
 * Why the app must not write the project's documents in the user's checkout now (G3, G7): another branch is checked
 * out, an operation is half done, or git is busy. Null when it can.
 */
export function documentsBlocker(state: CheckoutState, baseBranch: string): string | null {
  if (state.operation)
    return `Tu repositorio está a mitad de ${operationNames[state.operation]}. Termínalo o cancélalo (git ${state.operation === 'CHERRY_PICK' ? 'cherry-pick' : state.operation.toLowerCase()} --abort) y vuelve a intentarlo.`;
  if (state.indexLocked)
    return 'Git está ocupado en tu repositorio (hay un index.lock). Espera a que termine el otro programa y vuelve a intentarlo.';
  if (state.branch !== baseBranch)
    return `Tu repositorio tiene abierta ${state.branch ? `la rama ${state.branch}` : 'una versión sin rama'}, y los documentos del proyecto viven en ${baseBranch}. Cambia a ${baseBranch} (git checkout ${baseBranch}) para que la app los guarde.`;
  return null;
}

/** Rewrites the git errors a user can run into (busy repository, branch open elsewhere) as a readable message. */
export function readableGitError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/index\.lock|Unable to create .*\.lock/i.test(message))
    return new Error(
      'Git está ocupado en tu repositorio: otro programa lo está usando (hay un archivo .lock). Espera a que termine y vuelve a intentarlo.',
    );
  const open = /is already (?:checked out|used by worktree) at '([^']+)'/.exec(message);
  if (open) return new Error(`Esa rama ya está abierta en ${open[1]}. Cambia de rama allí y vuelve a intentarlo.`);
  return error instanceof Error ? error : new Error(message);
}

const locks = new Map<string, Promise<unknown>>();

/** Serializes the app's writes on one repository (G8): two app operations never touch the same repository at once. */
export async function withRepositoryLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.catch(() => undefined);
  locks.set(root, settled);
  try {
    return await run;
  } finally {
    if (locks.get(root) === settled) locks.delete(root);
  }
}
