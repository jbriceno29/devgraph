import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, lstat, readFile, readdir, rename, rm, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { StagedMarkdownFile, TransactionalMarkdownFilePort } from '../../planning/index.js';

export class TransactionalMarkdownFileStore implements TransactionalMarkdownFilePort {
  async applyAtomically(root: string, files: StagedMarkdownFile[], commit: () => void): Promise<void> {
    if (!files.length) {
      commit();
      return;
    }
    const base = await realpath(root);
    const staged: Array<{ target: string; temp: string; backup: string | null; existed: boolean }> = [];
    try {
      for (const file of files) staged.push(await stageFile(base, file));
      for (const item of staged) {
        if (item.existed) await rename(item.target, item.backup!);
        await rename(item.temp, item.target);
      }
      try {
        commit();
      } catch (error) {
        for (const item of [...staged].reverse()) {
          await rm(item.target, { force: true }).catch(() => undefined);
          if (item.backup) await rename(item.backup, item.target).catch(() => undefined);
        }
        throw error;
      }
      // The database is committed: from here on, never roll the files back. A leftover backup is cleaned up on the next open.
      for (const item of staged) if (item.backup) await rm(item.backup, { force: true }).catch(() => undefined);
    } catch (error) {
      for (const item of [...staged].reverse()) {
        await rm(item.temp, { force: true }).catch(() => undefined);
        if (item.backup) {
          await rm(item.target, { force: true }).catch(() => undefined);
          await rename(item.backup, item.target).catch(() => undefined);
        } else if (!item.existed) await rm(item.target, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }
  hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Repairs what an interrupted applyAtomically can leave under docs/: `.name.<uuid>.tmp` files are removed;
   * a `.name.<uuid>.bak` is restored when its target is gone, or when the backup (not the target) matches the
   * hash the database knows (the process died after moving files but before the database commit); otherwise it is removed.
   */
  async recoverInterruptedWrites(
    root: string,
    knownHashes: ReadonlyMap<string, string>,
  ): Promise<Array<{ path: string; action: 'removed-temp' | 'restored-backup' | 'removed-backup' }>> {
    const base = await realpath(root);
    const docs = join(base, 'docs');
    const actions: Array<{ path: string; action: 'removed-temp' | 'restored-backup' | 'removed-backup' }> = [];
    const info = await lstat(docs).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) return actions;
    const pattern = /^\.(.+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(tmp|bak)$/i;
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        const match = pattern.exec(entry.name);
        if (!match) continue;
        const target = join(directory, match[1]!),
          relativeTarget = relative(base, target).split(sep).join('/');
        if (match[2]!.toLowerCase() === 'tmp') {
          await rm(path, { force: true });
          actions.push({ path: relativeTarget, action: 'removed-temp' });
          continue;
        }
        const targetContent = await readFile(target, 'utf8').catch(() => null);
        const known = knownHashes.get(relativeTarget);
        const restore =
          targetContent === null ||
          (known !== undefined &&
            this.hash(await readFile(path, 'utf8')) === known &&
            this.hash(targetContent) !== known);
        if (restore) {
          await rename(path, target);
          actions.push({ path: relativeTarget, action: 'restored-backup' });
        } else {
          await rm(path, { force: true });
          actions.push({ path: relativeTarget, action: 'removed-backup' });
        }
      }
    };
    await walk(docs);
    return actions;
  }
}
function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`))
    throw new Error('La ruta Markdown debe permanecer dentro del repositorio.');
}

type Staged = { target: string; temp: string; backup: string | null; existed: boolean };

/** Writes one document to a temp file next to its target (safe path, no symlinks, synced), ready to swap in. */
async function stageFile(base: string, file: StagedMarkdownFile): Promise<Staged> {
  if (
    !file.relativePath.startsWith('docs/') ||
    !file.relativePath.toLowerCase().endsWith('.md') ||
    file.relativePath.includes('\\') ||
    file.relativePath.split('/').some(p => p === '..' || p === '.' || !p)
  )
    throw new Error('Ruta Markdown insegura.');
  const parts = file.relativePath.split('/');
  let parent = base;
  for (const part of parts.slice(0, -1)) {
    const next = join(parent, part);
    let info = await lstat(next).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(next);
      return lstat(next);
    });
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('No se permiten enlaces simbólicos ni rutas no directorio en la ruta Markdown.');
    parent = await realpath(next);
    assertInside(base, parent);
  }
  const target = resolve(parent, parts.at(-1)!);
  assertInside(base, target);
  const existing = await lstat(target).catch(error =>
    (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error),
  );
  if (existing && !file.replaceExisting) throw new Error(`Ya existe un documento en ${file.relativePath}.`);
  if (existing?.isSymbolicLink()) throw new Error('No se puede reemplazar un enlace simbólico.');
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', existing ? existing.mode & 0o777 : 0o666);
  try {
    await handle.writeFile(file.content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    target,
    temp,
    backup: existing ? join(dirname(target), `.${basename(target)}.${randomUUID()}.bak`) : null,
    existed: !!existing,
  };
}
