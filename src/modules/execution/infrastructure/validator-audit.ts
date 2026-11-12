import { lstat, readFile, readdir, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { git } from './git-isolation-service.js';
import type { AutonomyPolicy } from '../domain/governance.js';
import { ExecutionFileDiff } from './execution-validator.js';

export type GitRunner = (args: string[]) => Promise<string>;

/**
 * Commits every non-ignored change. Uses the repository's identity when configured, otherwise a neutral one.
 * Hooks stay disabled (see pinnedGit): the audit and the policy's checks are the gate, not repository hooks.
 */
export async function commitAll(run: GitRunner, message: string, excluded: string[] = []): Promise<void> {
  // The environment (node_modules) is never committed, even in a repository whose .gitignore forgot it.
  // Git runs with --literal-pathspecs (no :(exclude) magic): stage everything, then unstage the environment.
  await run(['add', '-A']);
  if (excluded.length) await run(['reset', '--quiet', '--', ...excluded]);
  if (
    await run(['diff', '--cached', '--quiet']).then(
      () => true,
      () => false,
    )
  )
    return;
  const hasIdentity = await run(['config', 'user.email']).then(
    value => Boolean(value.trim()),
    () => false,
  );
  const identity = hasIdentity ? [] : ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];
  await run([...identity, 'commit', '--no-verify', '--quiet', '-m', message]);
}

/** Runs Git against the trusted admin directory with repository-controlled command hooks disabled. */
export function pinnedGit(worktree: string, gitDir: string, args: string[]): Promise<string> {
  return git(worktree, [
    '--git-dir',
    gitDir,
    '--work-tree',
    worktree,
    '--literal-pathspecs',
    '-c',
    'core.fsmonitor=false',
    '-c',
    `core.hooksPath=${join(gitDir, 'graphdev-no-hooks')}`,
    ...args,
  ]);
}

/** Finds the worktree's admin directory by asking the main repository, never the worktree itself. */
export async function resolveWorktreeGitDir(repositoryRoot: string, worktree: string): Promise<string> {
  const commonDir = (
    await git(repositoryRoot, ['-c', 'core.fsmonitor=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim();
  const expected = await realpath(worktree);
  const entries = await readdir(join(commonDir, 'worktrees'), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const adminDir = join(commonDir, 'worktrees', entry.name);
    const pointer = (await readFile(join(adminDir, 'gitdir'), 'utf8').catch(() => '')).trim();
    if (!pointer) continue;
    const registered = await realpath(dirname(pointer)).catch(() => null);
    if (registered === expected) return adminDir;
  }
  throw new Error(`The execution worktree is not registered in the configured repository: ${worktree}`);
}

/** Returns true when the agent replaced or edited the worktree `.git` pointer, after restoring it. */
export async function restoreGitPointer(worktree: string, gitDir: string): Promise<boolean> {
  const pointerPath = join(worktree, '.git');
  const info = await lstat(pointerPath).catch(() => null);
  if (info?.isFile()) {
    const content = await readFile(pointerPath, 'utf8');
    const match = /^gitdir: (.+)\n?$/.exec(content);
    if (match && (await realpath(match[1]!).catch(() => null)) === (await realpath(gitDir))) return false;
  }
  await rm(pointerPath, { recursive: true, force: true });
  await writeFile(pointerPath, `gitdir: ${gitDir}\n`, 'utf8');
  return true;
}

/** Flags changed symlinks that leave the worktree or reach `.git`, denied or read-only paths. */
export async function auditSymlinks(worktree: string, paths: string[], policy: AutonomyPolicy): Promise<string[]> {
  const root = await realpath(worktree);
  const violations: string[] = [];
  for (const path of paths) {
    const absolute = join(root, ...path.split('/'));
    const info = await lstat(absolute).catch(() => null);
    if (!info?.isSymbolicLink()) continue;
    const literal = resolve(dirname(absolute), await readlink(absolute));
    const target = await realpath(absolute).catch(() => literal);
    const targets = [literal, target].map(item => relative(root, item));
    const unsafe = await Promise.all(
      targets.map(async rel => {
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return true;
        const repoPath = rel.split(sep).join('/');
        if (repoPath === '.git' || repoPath.startsWith('.git/')) return true;
        const isDirectory = await stat(join(root, rel)).then(
          item => item.isDirectory(),
          () => false,
        );
        const candidates = isDirectory ? [repoPath, `${repoPath}/`] : [repoPath];
        return candidates.some(
          candidate => isDenied(candidate, policy.deniedPaths) || isReadOnly(candidate, policy.readonlyPaths),
        );
      }),
    );
    if (unsafe.some(Boolean)) violations.push(path);
  }
  return violations;
}

export async function redactedChangeType(
  worktree: string,
  path: string,
  isUntracked: boolean,
): Promise<ExecutionFileDiff['changeType']> {
  const exists = await lstat(join(worktree, ...path.split('/'))).then(
    () => true,
    () => false,
  );
  return isUntracked ? 'ADDED' : exists ? 'MODIFIED' : 'DELETED';
}

export function splitNul(value: string): string[] {
  return value.split('\0').filter(Boolean);
}
export function safeRepoPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..'))
    throw new Error(`Git returned an unsafe path: ${path}`);
  return normalized;
}
// Denied paths are matched case-insensitively so `.ENV` cannot dodge `.env*` on case-insensitive filesystems.
export function isDenied(path: string, patterns: string[]): boolean {
  return matchesAny(path, patterns, 'i');
}
export function isReadOnly(path: string, patterns: string[]): boolean {
  return matchesAny(path, patterns);
}
export function matchesAny(path: string, patterns: string[], flags = ''): boolean {
  return patterns.some(pattern => glob(pattern, flags).test(path));
}

/**
 * Compiles a policy pattern with gitignore-like semantics:
 * - a pattern without `/` (`.env*`) matches that name at any depth, and everything beneath it;
 * - a pattern with `/` (or a leading `/`) is anchored at the repository root;
 * - `dir/**` also matches `dir` itself, because Git reports untracked ignored directories collapsed;
 * - `**` crosses directories, `*` and `?` stay within one path segment.
 */
export function glob(pattern: string, flags = ''): RegExp {
  const trimmed = pattern.trim().replace(/\/+$/, '');
  const anchored = trimmed.includes('/');
  let body = trimmed.replace(/^\/+/, '');
  const coversDirectory = body.endsWith('/**');
  if (coversDirectory) body = body.slice(0, -3);
  const translated = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**/', '\u0001')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll('\u0001', '(?:.*/)?')
    .replaceAll('\u0000', '.*');
  const source = anchored ? `^${translated}${coversDirectory ? '(?:/.*)?' : ''}$` : `^(?:.*/)?${translated}(?:/.*)?$`;
  return new RegExp(source, flags);
}
