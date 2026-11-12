import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type {
  AppSettingsDto,
  FolderInspectionDto,
  ProjectsFolderSuggestionDto,
} from '../../../shared/contracts/ipc-contracts.js';

/**
 * Where the user keeps their projects (one folder per project, e.g. ~/Documents/repos/my-app): an app-wide setting kept
 * in `<app data>/settings.json`, next to `projects/`. Only the folder is stored; the projects keep their own repository path.
 */
export class AppSettingsStore {
  private readonly file: string;
  constructor(
    rootDirectory: string,
    private readonly homeDirectory: string,
  ) {
    this.file = join(rootDirectory, 'settings.json');
  }

  async get(): Promise<AppSettingsDto> {
    return { projectsFolder: (await this.read()).projectsFolder ?? null, suggestion: await this.suggest() };
  }

  /** Creates the folder when missing (its parent chain too) and checks the app can write in it before saving it. */
  async setProjectsFolder(path: string): Promise<AppSettingsDto> {
    const folder = checkedAbsolutePath(path, 'la carpeta de proyectos');
    if (folder === normalize(this.homeDirectory) || dirname(folder) === folder)
      throw new Error(
        'Elige una carpeta dentro de tu carpeta personal, no la carpeta personal ni la raíz del sistema.',
      );
    const existing = await lstat(folder).catch(() => null);
    if (existing && !existing.isDirectory()) throw new Error(`«${folder}» existe y no es una carpeta.`);
    if (!existing) await mkdir(folder, { recursive: true });
    try {
      await access(folder, constants.W_OK);
    } catch {
      throw new Error(`La app no puede escribir en «${folder}». Elige otra carpeta.`);
    }
    const settings = { ...(await this.read()), projectsFolder: folder };
    const temporary = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
    return this.get();
  }

  /**
   * The folder to propose the first time: the first usual place that already holds Git repositories (the user keeps their
   * repos there), else the first usual place that exists, else ~/Documents/repos (or ~/repos without a Documents folder).
   */
  async suggest(): Promise<ProjectsFolderSuggestionDto> {
    const home = this.homeDirectory;
    const candidates = [
      ['Documents', 'repos'],
      ['Documentos', 'repos'],
      ['repos'],
      ['Documents', 'Projects'],
      ['Documentos', 'Proyectos'],
      ['Projects'],
      ['Proyectos'],
      ['code'],
      ['dev'],
      ['src'],
    ].map(parts => join(home, ...parts));
    let firstExisting: ProjectsFolderSuggestionDto | null = null;
    for (const path of candidates) {
      const count = await countRepositories(path);
      if (count === null) continue;
      if (count > 0) return { path, exists: true, repositoryCount: count };
      firstExisting ??= { path, exists: true, repositoryCount: 0 };
    }
    if (firstExisting) return firstExisting;
    const documents = (await isDirectory(join(home, 'Documents')))
      ? join(home, 'Documents', 'repos')
      : (await isDirectory(join(home, 'Documentos')))
        ? join(home, 'Documentos', 'repos')
        : join(home, 'repos');
    return { path: documents, exists: false, repositoryCount: 0 };
  }

  private async read(): Promise<{ projectsFolder?: string | null }> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as { projectsFolder?: string | null }) : {};
    } catch {
      return {};
    }
  }
}

/** What is at a path, so the UI can say before creating a project whether the folder is new, empty, a repository or taken. */
export async function inspectFolder(path: string): Promise<FolderInspectionDto> {
  const target = checkedAbsolutePath(path, 'la carpeta');
  const info = await lstat(target).catch(() => null);
  const parentExists = await isDirectory(dirname(target));
  if (!info)
    return { path: target, exists: false, isDirectory: false, empty: false, isGitRepository: false, parentExists };
  if (!info.isDirectory())
    return { path: target, exists: true, isDirectory: false, empty: false, isGitRepository: false, parentExists };
  const entries = await readdir(target).catch(() => [] as string[]);
  return {
    path: target,
    exists: true,
    isDirectory: true,
    empty: entries.length === 0,
    isGitRepository: entries.includes('.git'),
    parentExists,
  };
}

/** Absolute, without `.`/`..` segments or NUL (the same rules as the repository initializer). */
export function checkedAbsolutePath(path: string, what: string): string {
  const value = String(path ?? '').trim();
  if (!value || value.includes('\0')) throw new Error(`Indica la ruta de ${what}.`);
  if (!isAbsolute(value)) throw new Error(`La ruta de ${what} debe ser absoluta.`);
  if (value.split(/[\\/]+/).some(part => part === '.' || part === '..'))
    throw new Error('La ruta no puede contener «..» ni «.».');
  const normalized = normalize(value);
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, '') : normalized;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isDirectory() ?? false;
}

/** Number of direct subfolders holding `.git`, or null when the folder does not exist. */
async function countRepositories(path: string): Promise<number | null> {
  if (!(await isDirectory(path))) return null;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries)
    if (
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      (await lstat(join(path, entry.name, '.git')).catch(() => null))
    )
      count++;
  return count;
}
