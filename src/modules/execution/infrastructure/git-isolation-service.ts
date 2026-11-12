import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { GitIsolationPort } from '../application/ports/agent-execution-port.js';
import { type MergeInput, integrateInto, mergeIntoBase } from './git-merges.js';

const execFileAsync = promisify(execFile);
const uuid = /^[a-f0-9-]{36}$/i;

/** Creates one dedicated Git branch/worktree per execution. */
export class GitIsolationService implements Omit<GitIsolationPort, 'copyPaths'> {
  /** `startPoint` is the integration branch (or, for a revision, the commit of the run being adjusted); default HEAD. */
  async prepare(input: {
    projectId: string;
    executionId: string;
    workItemKey: string;
    repositoryRoot: string;
    workspaceRoot: string;
    requireWorktree: boolean;
    startPoint?: string;
  }) {
    if (!uuid.test(input.projectId) || !uuid.test(input.executionId))
      throw new Error('Invalid project or execution id for worktree isolation.');
    const repositoryRoot = await realpath(input.repositoryRoot);
    const topLevel = await git(repositoryRoot, ['rev-parse', '--show-toplevel']);
    if (resolve(topLevel.trim()) !== repositoryRoot)
      throw new Error('The configured repository path must be the Git repository root.');
    const startPoint = input.startPoint ?? 'HEAD';
    const baseCommit = (await git(repositoryRoot, ['rev-parse', '--verify', `${startPoint}^{commit}`])).trim();
    // The branch the run integrates into: the given branch, or the one checked out in the user's repository (null when detached).
    const isBranch = input.startPoint
      ? await git(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${input.startPoint}`]).then(
          () => true,
          () => false,
        )
      : false;
    const baseBranch = isBranch
      ? input.startPoint!
      : input.startPoint
        ? null
        : (await git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null;
    const safeKey =
      input.workItemKey
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 28) || 'task';
    const branchName = `graphdev/${safeKey}-${input.executionId.slice(0, 8)}`;
    const workingDirectory = join(input.workspaceRoot, 'projects', input.projectId, 'worktrees', input.executionId);
    await mkdir(dirname(workingDirectory), { recursive: true });
    try {
      await git(repositoryRoot, ['worktree', 'add', '-b', branchName, workingDirectory, baseCommit]);
    } catch (error) {
      throw new Error(
        `Unable to create isolated Git worktree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { workingDirectory, branchName, baseCommit, baseBranch };
  }

  /** Without a configured base (see SafeGitIsolation): the branch checked out now, or null when HEAD is detached. */
  async baseBranch(repositoryRoot: string): Promise<string | null> {
    return (
      (
        await git(await realpath(repositoryRoot), ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')
      ).trim() || null
    );
  }

  async branchExists(repositoryRoot: string, branchName: string): Promise<boolean> {
    return git(await realpath(repositoryRoot), ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]).then(
      () => true,
      () => false,
    );
  }

  /**
   * Creates the integration branch for a feature from `sourceRef` without touching the user's checkout.
   * If `preferredName` is taken by a branch Graph Workspace does not own, a numeric suffix is added.
   */
  async createIntegrationBranch(input: {
    repositoryRoot: string;
    preferredName: string;
    sourceRef: string;
  }): Promise<string> {
    const repositoryRoot = await realpath(input.repositoryRoot);
    const sourceCommit = (await git(repositoryRoot, ['rev-parse', '--verify', `${input.sourceRef}^{commit}`])).trim();
    for (let attempt = 1; attempt < 100; attempt += 1) {
      const name = attempt === 1 ? input.preferredName : `${input.preferredName}-${attempt}`;
      await git(repositoryRoot, ['check-ref-format', '--branch', name]);
      const exists = await git(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).then(
        () => true,
        () => false,
      );
      if (exists) continue;
      await git(repositoryRoot, ['branch', name, sourceCommit]);
      return name;
    }
    throw new Error(`No hay un nombre de rama libre para ${input.preferredName}.`);
  }

  /**
   * Squash-merges `sourceRef` into `targetBranch` inside a throwaway worktree, so the user's checkout is never touched.
   * Refuses when the target branch is checked out somewhere (updating it would desynchronize that working tree).
   */
  async squashMerge(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    targetBranch: string;
    sourceRef: string;
    message: string;
  }): Promise<SquashMergeResult> {
    return integrateInto(input, 'squash');
  }

  /** Brings `targetBranch` up to date with `sourceRef` through a merge commit (used to sync a feature branch with the user's branch). */
  async mergeInto(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    projectId: string;
    targetBranch: string;
    sourceRef: string;
    message: string;
  }): Promise<SquashMergeResult> {
    return integrateInto(input, 'merge');
  }

  async isAncestor(repositoryRoot: string, ancestor: string, descendant: string): Promise<boolean> {
    return git(await realpath(repositoryRoot), ['merge-base', '--is-ancestor', ancestor, descendant]).then(
      () => true,
      () => false,
    );
  }

  /** Only `feature/` branches that are not checked out anywhere: a rollback of `createIntegrationBranch`. */
  async deleteIntegrationBranch(repositoryRoot: string, branchName: string): Promise<void> {
    if (!/^(graphdev\/)?feature\//.test(branchName))
      throw new Error('Solo se eliminan ramas de integración creadas por Graph Workspace.');
    const root = await realpath(repositoryRoot);
    if (checkedOutPath(await git(root, ['worktree', 'list', '--porcelain']), branchName)) return;
    await git(root, ['branch', '-D', branchName]);
  }

  /**
   * Integrates a finished feature into the project's base branch with a merge commit (so later merges of the same branch
   * are no-ops). The merge is built on a detached throwaway worktree; then the branch moves forward: by a fast-forward of
   * the user's checkout when it is on that branch (and only when it has no uncommitted changes), or by a compare-and-swap
   * ref update otherwise. Never forces, never pushes, never deletes the source branch.
   */
  async mergeIntoBase(input: MergeInput): Promise<BaseMergeResult> {
    return mergeIntoBase(input, async (ancestor, descendant) =>
      this.isAncestor(await realpath(input.repositoryRoot), ancestor, descendant),
    );
  }

  /** Paths among `paths` with uncommitted changes in the user's checkout (modified, deleted or untracked). */
  async uncommittedPaths(repositoryRoot: string, paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const records = (
      await git(await realpath(repositoryRoot), [
        '--literal-pathspecs',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        ...paths,
      ])
    )
      .split('\0')
      .filter(Boolean);
    const dirty: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      dirty.push(record.slice(3));
      if (record[0] === 'R' || record[0] === 'C') index += 1;
    }
    return [...new Set(dirty)].sort();
  }

  /** Files changed by a commit relative to its first parent (the net change of a squash-merged task). */
  async commitFiles(
    repositoryRoot: string,
    commit: string,
  ): Promise<Array<{ path: string; status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' }>> {
    const records = (
      await git(await realpath(repositoryRoot), [
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-r',
        '-z',
        '-M',
        `${commit}^`,
        commit,
      ])
    )
      .split('\0')
      .filter(Boolean);
    const files: Array<{ path: string; status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' }> = [];
    for (let index = 0; index < records.length; index += 1) {
      const code = records[index]![0];
      if (code === 'R') {
        files.push({ path: records[index + 2]!, status: 'RENAMED' });
        index += 2;
        continue;
      }
      files.push({ path: records[index + 1]!, status: code === 'A' ? 'ADDED' : code === 'D' ? 'DELETED' : 'MODIFIED' });
      index += 1;
    }
    return files;
  }

  /** Paths whose content differs between two refs (including paths missing from one of them). */
  async pathsDiffer(repositoryRoot: string, leftRef: string, rightRef: string, paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const output = await git(await realpath(repositoryRoot), [
      '--literal-pathspecs',
      'diff',
      '--name-only',
      '-z',
      leftRef,
      rightRef,
      '--',
      ...paths,
    ]);
    return output.split('\0').filter(Boolean).sort();
  }

  async discard(input: {
    repositoryRoot: string;
    workspaceRoot: string;
    workingDirectory: string;
    branchName: string;
  }): Promise<void> {
    // Only ever touch what `prepare` creates: a graphdev/ branch and a worktree under the workspace worktrees folder.
    const worktreesRoot = resolve(input.workspaceRoot, 'projects');
    const target = resolve(input.workingDirectory);
    const rel = relative(worktreesRoot, target).split(sep);
    if (
      !input.branchName.startsWith('graphdev/') ||
      rel.length !== 3 ||
      rel[0] === '' ||
      rel[0] === '..' ||
      rel[1] !== 'worktrees' ||
      !uuid.test(rel[0]!) ||
      !uuid.test(rel[2]!)
    )
      throw new Error('Refusing to discard a worktree that Graph Workspace did not create.');
    const repositoryRoot = await realpath(input.repositoryRoot);
    await git(repositoryRoot, ['worktree', 'remove', '--force', target]).catch(() => undefined);
    await rm(target, { recursive: true, force: true });
    await git(repositoryRoot, ['worktree', 'prune']);
    await git(repositoryRoot, ['branch', '-D', input.branchName]).catch(() => undefined);
  }
}

export async function git(cwd: string, args: string[], maxBuffer = 32 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer, windowsHide: true });
  return stdout;
}

const defaultIdentity = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];
export type BaseMergeResult =
  | { ok: true; commit: string; changed: boolean }
  | { ok: false; reason: 'CONFLICT' | 'CHECKED_OUT' | 'DIRTY'; detail: string; conflicts: string[] };
export type SquashMergeResult =
  | { ok: true; commit: string; changed: boolean }
  | { ok: false; reason: 'CONFLICT' | 'CHECKED_OUT'; detail: string; conflicts: string[] };

export function checkedOutPath(porcelain: string, branch: string): string | null {
  let path: string | null = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}
