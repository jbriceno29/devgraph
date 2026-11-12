import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { DESIGN_PROTOTYPE_PATH } from '../../shared/ui-spec.js';
import type { DesignPrototypeWriterPort } from '../../application/inception/project-inception-service.js';

/**
 * Saves the approved prototype in the user's repository (`docs/design/prototype.html`) so every worktree and agent can open it.
 * The Markdown store only accepts `.md`, so this file is written here: inside the repository, never through a symbolic link, atomically.
 */
export class DesignPrototypeWriter implements DesignPrototypeWriterPort {
  async write(repositoryPath: string, html: string): Promise<string> {
    const root = await realpath(repositoryPath);
    let parent = root;
    for (const part of DESIGN_PROTOTYPE_PATH.split('/').slice(0, -1)) {
      const next = join(parent, part);
      let info = await lstat(next).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return null; });
      if (!info) { await mkdir(next); info = await lstat(next); }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`No se puede guardar el prototipo: ${part} no es una carpeta normal.`);
      parent = await realpath(next);
      if (relative(root, parent).startsWith('..')) throw new Error('La ruta del prototipo sale del repositorio.');
    }
    const target = resolve(parent, DESIGN_PROTOTYPE_PATH.split('/').at(-1)!);
    const existing = await lstat(target).catch(() => null);
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error('Ya existe un elemento que no es un archivo en la ruta del prototipo.');
    const temp = join(dirname(target), `.prototype.${randomUUID()}.tmp`);
    await writeFile(temp, html, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, target);
    return DESIGN_PROTOTYPE_PATH;
  }
}
