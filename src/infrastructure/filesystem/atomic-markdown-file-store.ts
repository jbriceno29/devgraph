import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AtomicMarkdownFilePort, MarkdownFileResult } from '../../application/ports/artifact-management-port.js';

export class AtomicMarkdownFileStore implements AtomicMarkdownFilePort {
  async resolveGitRepository(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new Error('La ruta del repositorio debe ser absoluta.');
    const root = await realpath(path);
    const info = await lstat(root);
    if (!info.isDirectory()) throw new Error('La ruta seleccionada no es una carpeta.');
    try {
      await access(join(root, '.git'), constants.F_OK);
    } catch {
      throw new Error('La carpeta no contiene un repositorio Git (.git).');
    }
    return root;
  }

  async ensureDocsDirectory(repositoryRoot: string): Promise<void> {
    const root = await realpath(repositoryRoot);
    await mkdir(join(root, 'docs'), { recursive: true });
    const docs = await realpath(join(root, 'docs'));
    assertInside(root, docs);
  }

  async readMarkdown(repositoryRoot: string, relativePath: string): Promise<MarkdownFileResult> {
    const file = await this.safePath(repositoryRoot, relativePath);
    const content = await readFile(file, 'utf8');
    return { content, contentHash: hash(content) };
  }

  async markdownExists(repositoryRoot: string, relativePath: string): Promise<boolean> {
    const file = await this.safePath(repositoryRoot, relativePath, true);
    return lstat(file)
      .then(() => true)
      .catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      });
  }

  async writeMarkdownAtomically(
    repositoryRoot: string,
    relativePath: string,
    content: string,
  ): Promise<MarkdownFileResult> {
    if (!relativePath.toLowerCase().endsWith('.md'))
      throw new Error('Solo se pueden sincronizar archivos Markdown (.md).');
    const file = await this.safePath(repositoryRoot, relativePath, true);
    const existing = await lstat(file).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) throw new Error('No se puede sobrescribir un enlace simbólico Markdown.');
    const mode = existing ? existing.mode & 0o777 : 0o666;
    const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temp, 'wx', mode);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, file);
      return { content, contentHash: hash(content) };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async removeMarkdown(repositoryRoot: string, relativePath: string): Promise<void> {
    const file = await this.safePath(repositoryRoot, relativePath, true);
    await rm(file, { force: true });
  }

  watchDocs(repositoryRoot: string, onChange: (relativePath: string | null) => void): () => void {
    const docsRoot = join(repositoryRoot, 'docs');
    const watcher = watch(docsRoot, { recursive: true }, (_eventType, filename) => {
      if (filename === null) {
        onChange(null);
        return;
      }
      const name = filename.toString().split(sep).join('/');
      if (name.toLowerCase().endsWith('.md')) onChange(`docs/${name}`);
    });
    return () => watcher.close();
  }

  private async safePath(repositoryRoot: string, relativePath: string, createParent = false): Promise<string> {
    if (!relativePath || isAbsolute(relativePath) || relativePath.includes('\\'))
      throw new Error('La ruta del documento debe ser relativa al repositorio.');
    const normalized = relativePath.split('/').filter(Boolean);
    if (normalized.some(part => part === '.' || part === '..'))
      throw new Error('La ruta del documento no puede salir del repositorio.');
    const root = await realpath(repositoryRoot);
    let parent = root;
    for (const part of normalized.slice(0, -1)) {
      const next = join(parent, part);
      let info = await lstat(next).catch(async error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !createParent) throw error;
        await mkdir(next);
        return lstat(next);
      });
      if (info.isSymbolicLink()) throw new Error('No se permiten enlaces simbólicos en la ruta del documento.');
      if (!info.isDirectory()) throw new Error('La ruta del documento contiene un componente que no es carpeta.');
      parent = await realpath(next);
      assertInside(root, parent);
    }
    const candidate = resolve(parent, normalized.at(-1)!);
    assertInside(root, candidate);
    const existing = await lstat(candidate).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) {
      const realFile = await realpath(candidate);
      assertInside(root, realFile);
    }
    return candidate;
  }
}

const hash = (content: string) => createHash('sha256').update(content).digest('hex');
function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('La ruta del documento debe permanecer dentro del repositorio.');
}
