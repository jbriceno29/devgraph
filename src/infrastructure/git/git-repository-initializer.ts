import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { devNull } from 'node:os';
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

const execFileAsync = promisify(execFile);
/** Same fallback identity the app already uses for its own commits (documents, merges). */
const IDENTITY = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];
const GITIGNORE = 'node_modules/\ndist/\ncoverage/\n.env\n.env.*\n*.log\n.DS_Store\n';

/**
 * Creates a brand-new Git repository for a project (inception, greenfield). Safe by construction: absolute path without
 * `..`, the folder must not exist or be empty, `git init --template=` (no hooks, no templates), git pinned to ignore the
 * system and global configuration (no user hooks, aliases or signing), no remotes, and never deletes anything — on
 * failure what was created stays for the user to inspect.
 */
export class GitRepositoryInitializer {
  async initialize(input: { path: string; projectName: string; description?: string | null }): Promise<{ localPath: string; initialCommit: string; files: string[] }> {
    const path = String(input.path ?? '');
    if (!path.trim() || path.includes('\0')) throw new Error('Indica la ruta de la carpeta del repositorio.');
    if (!isAbsolute(path)) throw new Error('La ruta del repositorio debe ser absoluta.');
    if (path.split(/[\\/]+/).some(part => part === '..' || part === '.')) throw new Error('La ruta no puede contener «..» ni «.».');
    const target = normalize(path).replace(/[\\/]+$/, '') || path;
    if (dirname(target) === target) throw new Error('No se puede usar la raíz del sistema como repositorio.');
    const parent = await realpath(dirname(target)).catch(() => { throw new Error(`La carpeta padre no existe: ${dirname(target)}`); });
    const root = join(parent, basename(target));
    const existing = await lstat(root).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('La ruta ya existe y no es una carpeta.');
      if ((await readdir(root)).length) throw new Error('La carpeta ya existe y no está vacía. Elige una carpeta nueva o vacía (para un repositorio existente usa «Configurar repositorio»).');
    } else await mkdir(root);
    const git = (args: string[]) => pinnedGit(root, args);
    await git(['init', '--quiet', '--template=', '-b', 'main']);
    const name = input.projectName.trim() || basename(root);
    const files: Array<[string, string]> = [['README.md', `# ${name}\n\n${input.description?.trim() ? `${input.description.trim()}\n\n` : ''}Proyecto creado con Graph Workspace. La visión, las decisiones y el plan están en \`docs/\`.\n`], ['.gitignore', GITIGNORE]];
    await mkdir(join(root, 'docs'));
    for (const [file, content] of files) await writeFile(join(root, file), content, { encoding: 'utf8', flag: 'wx' });
    const paths = files.map(([file]) => file);
    await git(['add', '--', ...paths]);
    await git([...IDENTITY, 'commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', 'chore: repositorio inicial (Graph Workspace)', '--', ...paths]);
    return { localPath: root, initialCommit: (await git(['rev-parse', 'HEAD'])).trim(), files: paths };
  }
}

/** Git without system or global configuration, without hooks and without fsmonitor (also used, read-only, by the repository scanner). */
export async function pinnedGit(cwd: string, args: string[], options: { maxBuffer?: number } = {}): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TEMPLATE_DIR: '', GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[key];
  const { stdout } = await execFileAsync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', timeout: 30_000, windowsHide: true, ...(options.maxBuffer ? { maxBuffer: options.maxBuffer } : {}) });
  return stdout;
}
