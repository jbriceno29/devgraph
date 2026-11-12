import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { ContextFilePort } from '../application/ports/context-engine-port.js';
const execFileAsync = promisify(execFile);
/** Largest file a context source may have, on disk or in a commit. */
export const MAX_CONTEXT_FILE_BYTES = 2 * 1024 * 1024;
export class RepositoryContextFileStore implements ContextFilePort {
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
  /** HEAD of the user's checkout: only for previews outside an execution (an execution pins its own commit). */
  async getHeadCommit(repositoryRoot: string): Promise<string> {
    try {
      await access(join(repositoryRoot, '.git'), constants.F_OK);
      const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { timeout: 5000 });
      return stdout.trim() || 'UNCOMMITTED';
    } catch {
      return 'UNCOMMITTED';
    }
  }
  /**
   * Reads a context source. With `commit`, from that commit's tree (an execution's start point), never from the user's
   * working copy; without it, from the working copy (previews in the UI).
   */
  async readRepositoryFile(
    repositoryRoot: string,
    relativePath: string,
    commit?: string,
  ): Promise<{ content: string; contentHash: string }> {
    if (
      !relativePath ||
      isAbsolute(relativePath) ||
      /^[A-Za-z]:/.test(relativePath) ||
      relativePath.includes('\\') ||
      relativePath.split('/').some(part => part === '.' || part === '..' || !part)
    )
      throw new Error('La ruta de contexto debe ser relativa y segura.');
    if (commit !== undefined) return this.readAtCommit(repositoryRoot, relativePath, commit);
    const root = await realpath(repositoryRoot);
    let parent = root;
    const parts = relativePath.split('/');
    for (const part of parts.slice(0, -1)) {
      const next = join(parent, part),
        info = await lstat(next);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error('No se permiten enlaces simbólicos en las rutas de contexto.');
      parent = await realpath(next);
      assertInside(root, parent);
    }
    const target = join(parent, parts.at(-1)!);
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('La fuente de contexto no es un archivo regular.');
    if (info.size > MAX_CONTEXT_FILE_BYTES) throw new Error('La fuente de contexto es demasiado grande.');
    const content = await readFile(target, 'utf8');
    return { content, contentHash: this.hashContent(content) };
  }
  /** Reads a regular file (no symlink, no submodule) from a commit's tree through Git's object store only. */
  private async readAtCommit(
    repositoryRoot: string,
    relativePath: string,
    commit: string,
  ): Promise<{ content: string; contentHash: string }> {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) throw new Error('El commit de contexto no es válido.');
    const root = await realpath(repositoryRoot);
    const { stdout: commonDir } = await execFileAsync(
      'git',
      ['-C', root, '-c', 'core.fsmonitor=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 5000, windowsHide: true },
    );
    const gitDir = commonDir.trim(),
      run = (args: string[]) => pinnedGit(gitDir, args);
    const entry = (await run(['ls-tree', '-z', '--full-tree', commit, '--', relativePath]))
      .split('\0')
      .find(record => record.slice(record.indexOf('\t') + 1) === relativePath);
    const [mode, type, oid] = (entry?.slice(0, entry.indexOf('\t')) ?? '').split(' ');
    if (!entry || type !== 'blob' || !oid || !['100644', '100755'].includes(mode!))
      throw new Error('La fuente de contexto no es un archivo regular en el commit de la ejecución.');
    if (Number((await run(['cat-file', '-s', oid])).trim()) > MAX_CONTEXT_FILE_BYTES)
      throw new Error('La fuente de contexto es demasiado grande.');
    const content = await run(['cat-file', 'blob', oid]);
    return { content, contentHash: this.hashContent(content) };
  }
}
/** Git against a fixed admin directory, with no work tree, hooks or fsmonitor: nothing from the repository runs. */
async function pinnedGit(gitDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    [
      '--git-dir',
      gitDir,
      '--literal-pathspecs',
      '-c',
      'core.fsmonitor=false',
      '-c',
      `core.hooksPath=${join(gitDir, 'graphdev-no-hooks')}`,
      ...args,
    ],
    {
      cwd: gitDir,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: MAX_CONTEXT_FILE_BYTES + 1024 * 1024,
      windowsHide: true,
    },
  );
  return stdout;
}
function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('La ruta de contexto debe permanecer dentro del repositorio.');
}
