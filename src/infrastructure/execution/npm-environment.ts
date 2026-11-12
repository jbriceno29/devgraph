import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  EnvironmentReconcileResult,
  WorkspaceEnvironmentPort,
} from '../../application/ports/agent-execution-port.js';
import type { ProjectEnvironment } from '../../domain/projects/stack-catalog.js';
import { git } from '../git/git-isolation-service.js';

const execFileAsync = promisify(execFile);
/** Lifecycle scripts of third-party packages never run; nor do audits or funding notices, which only add network calls and noise. */
const SAFE_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'];
const MANIFEST = 'package.json',
  LOCKFILE = 'package-lock.json',
  PNPM_LOCKFILE = 'pnpm-lock.yaml';
type Manager = 'npm' | 'pnpm';
/** Each manager's install: `frozen` reproduces the lockfile exactly, `update` follows the manifest and rewrites the lockfile. Scripts never run. */
const INSTALL: Record<Manager, { frozen: string[]; update: string[]; lockfile: string }> = {
  npm: { frozen: ['ci', ...SAFE_FLAGS], update: ['install', ...SAFE_FLAGS], lockfile: LOCKFILE },
  pnpm: {
    frozen: ['install', '--frozen-lockfile', '--ignore-scripts', '--reporter=silent'],
    update: ['install', '--ignore-scripts', '--reporter=silent'],
    lockfile: PNPM_LOCKFILE,
  },
};
type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};

export interface NpmEnvironmentOptions {
  /** The npm executable (default: `npm` from PATH). */
  npm?: string;
  /** The pnpm executable (default: `pnpm` from PATH), for repositories with pnpm-lock.yaml. */
  pnpm?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

/**
 * Plan S2 with npm: the app installs the stack profile's packages in each run's fresh worktree, so the agent and the
 * checks work with real dependencies while the agent itself never installs anything (its tools cannot run npm).
 */
export class NpmEnvironment implements Omit<WorkspaceEnvironmentPort, 'forProject'> {
  constructor(private readonly options: NpmEnvironmentOptions = {}) {}

  async provision(input: {
    workingDirectory: string;
    projectName: string;
    environment: ProjectEnvironment;
  }): Promise<{ log: string; commit: string | null; installed?: boolean }> {
    const cwd = input.workingDirectory,
      log: string[] = [];
    let manifest = await readManifest(cwd);
    if (manifest === undefined) throw new Error(`${MANIFEST} no es JSON válido; corrígelo antes de ejecutar.`);
    // An existing repository: install exactly what it declares, with the manager its lockfile names.
    if (input.environment.packageManager === 'detect') return this.provisionExisting(cwd, manifest);
    if (manifest === null) {
      manifest = { name: npmName(input.projectName), version: '0.1.0', private: true, type: 'module' };
      await writeFile(join(cwd, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      log.push(`Creado ${MANIFEST} para el perfil ${input.environment.stackProfileId}.`);
    }
    const declared = new Set(declaredNames(manifest));
    const missing = input.environment.dependencies.filter(name => !declared.has(name)),
      missingDev = input.environment.devDependencies.filter(name => !declared.has(name));
    if (missing.length) log.push(await this.npm(cwd, ['install', '--save-prod', ...SAFE_FLAGS, ...missing]));
    if (missingDev.length) log.push(await this.npm(cwd, ['install', '--save-dev', ...SAFE_FLAGS, ...missingDev]));
    if (!missing.length && !missingDev.length)
      log.push(
        await this.npm(cwd, (await exists(join(cwd, LOCKFILE))) ? ['ci', ...SAFE_FLAGS] : ['install', ...SAFE_FLAGS]),
      );
    // The worktree is fresh and the agent has not run yet: plain Git is safe here, with hooks disabled all the same.
    const changed = (await git(cwd, ['status', '--porcelain', '--', MANIFEST, LOCKFILE])).trim();
    if (!changed) return { log: log.join('\n'), commit: null };
    await git(cwd, ['add', '--', MANIFEST, ...((await exists(join(cwd, LOCKFILE))) ? [LOCKFILE] : [])]);
    const identity = await git(cwd, ['config', 'user.email']).then(
      value => (value.trim() ? [] : DEFAULT_IDENTITY),
      () => DEFAULT_IDENTITY,
    );
    await git(cwd, [
      ...identity,
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--no-verify',
      '--quiet',
      '-m',
      `chore(entorno): dependencias del perfil ${input.environment.stackProfileId}`,
    ]);
    log.push(`Commit del entorno con ${MANIFEST}${changed.includes(LOCKFILE) ? ` y ${LOCKFILE}` : ''}.`);
    return { log: log.join('\n'), commit: (await git(cwd, ['rev-parse', 'HEAD'])).trim() };
  }

  /** Plan S2 for a repository that follows no profile (brownfield, or created before the catalog). */
  private async provisionExisting(
    cwd: string,
    manifest: Manifest | null,
  ): Promise<{ log: string; commit: string | null; installed: boolean }> {
    if (manifest === null)
      return { log: `Sin ${MANIFEST}: no hay dependencias que instalar.`, commit: null, installed: false };
    if (!declaredNames(manifest).length)
      return { log: `${MANIFEST} no declara dependencias: nada que instalar.`, commit: null, installed: false };
    const manager = await managerOf(cwd);
    const lockfile = INSTALL[manager].lockfile;
    const frozen = await exists(join(cwd, lockfile));
    const log = [
      `Repositorio sin perfil del catálogo: se instala lo que declara ${MANIFEST} con ${manager}${frozen ? ` (${lockfile})` : ', sin lockfile'}.`,
    ];
    log.push(await this.run(manager, cwd, frozen ? INSTALL[manager].frozen : INSTALL[manager].update));
    if (frozen) return { log: log.join('\n'), commit: null, installed: true };
    // No lockfile yet: the one just written is committed apart, so every later run installs the same versions.
    const commit = await commitEnvironment(
      cwd,
      [lockfile],
      `chore(entorno): lockfile de las dependencias (${lockfile})`,
    );
    if (commit) log.push(`Commit del entorno con ${lockfile}.`);
    return { log: log.join('\n'), commit, installed: true };
  }

  async reconcile(input: {
    workingDirectory: string;
    baseManifest: string | null;
    environment: ProjectEnvironment;
  }): Promise<EnvironmentReconcileResult> {
    const cwd = input.workingDirectory;
    const current = await readManifest(cwd);
    if (current === undefined)
      return { ok: false, reason: 'ENVIRONMENT', unapproved: [], log: `${MANIFEST} quedó con JSON inválido.` };
    const base = parseManifest(input.baseManifest);
    const before = specs(base ?? {}),
      after = specs(current ?? {});
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      name => before.get(name) !== after.get(name),
    );
    if (!changed.length) return { ok: true, log: '' };
    const allowed = new Set(input.environment.allowedPackages);
    const unapproved = changed.filter(name => after.has(name) && !allowed.has(name)).sort();
    if (unapproved.length)
      return {
        ok: false,
        reason: 'DEPENDENCY_APPROVAL',
        unapproved,
        log: `Dependencias sin aprobar: ${unapproved.join(', ')}.`,
      };
    try {
      const manager = input.environment.packageManager === 'detect' ? await managerOf(cwd) : 'npm';
      return {
        ok: true,
        log: `Dependencias cambiadas (${changed.join(', ')}); reinstaladas por la app.\n${await this.run(manager, cwd, INSTALL[manager].update)}`,
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'ENVIRONMENT',
        unapproved: [],
        log: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private npm(cwd: string, args: string[]): Promise<string> {
    return this.run('npm', cwd, args);
  }

  private async run(manager: Manager, cwd: string, args: string[]): Promise<string> {
    const command = (manager === 'pnpm' ? this.options.pnpm : this.options.npm) ?? manager;
    try {
      const result = await execFileAsync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: this.options.timeoutMs ?? 10 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: this.options.environment ?? process.env,
      });
      return `$ ${manager} ${args.join(' ')}\n${result.stdout}${result.stderr}`.trim();
    } catch (error) {
      const failure = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };
      if (failure.code === 'ENOENT')
        throw new Error(
          manager === 'pnpm'
            ? 'El repositorio usa pnpm (pnpm-lock.yaml) y no se encontró pnpm. Instálalo (por ejemplo con corepack enable).'
            : 'No se encontró npm. Instala Node.js con npm para los proyectos con dependencias.',
        );
      throw new Error(
        `Falló «${manager} ${args.join(' ')}»: ${`${failure.stderr ?? ''}${failure.stdout ?? ''}`.trim().slice(-2000) || failure.message}`,
      );
    }
  }
}

const DEFAULT_IDENTITY = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];

/** The manager the repository's lockfile names. Yarn is refused with a clear message: its modes (PnP, scripts config) need their own support. */
async function managerOf(cwd: string): Promise<Manager> {
  if (await exists(join(cwd, PNPM_LOCKFILE))) return 'pnpm';
  if ((await exists(join(cwd, 'yarn.lock'))) && !(await exists(join(cwd, LOCKFILE))))
    throw new Error(
      'El repositorio usa yarn (yarn.lock), que la app todavía no sabe instalar. Usa npm o pnpm, o instala las dependencias a mano.',
    );
  return 'npm';
}

/** Commits the given files in a fresh worktree (before the agent runs, so plain Git is safe; hooks off). Null when nothing changed. */
async function commitEnvironment(cwd: string, files: string[], message: string): Promise<string | null> {
  const present: string[] = [];
  for (const file of files) if (await exists(join(cwd, file))) present.push(file);
  if (!present.length || !(await git(cwd, ['status', '--porcelain', '--', ...present])).trim()) return null;
  await git(cwd, ['add', '--', ...present]);
  const identity = await git(cwd, ['config', 'user.email']).then(
    value => (value.trim() ? [] : DEFAULT_IDENTITY),
    () => DEFAULT_IDENTITY,
  );
  await git(cwd, [...identity, '-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '--quiet', '-m', message]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** null: no manifest; undefined: a manifest that is not a JSON object. */
async function readManifest(cwd: string): Promise<Manifest | null | undefined> {
  const text = await readFile(join(cwd, MANIFEST), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return text === null ? null : (parseManifest(text) ?? undefined);
}
function parseManifest(text: string | null): Manifest | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Manifest) : null;
  } catch {
    return null;
  }
}
function declaredNames(manifest: Manifest): string[] {
  return [...specs(manifest).keys()];
}
/** Every declared package with its spec (section included, so moving a package between sections counts as a change). */
function specs(manifest: Manifest): Map<string, string> {
  const result = new Map<string, string>();
  for (const section of SECTIONS) {
    const entries = manifest[section];
    if (entries && typeof entries === 'object')
      for (const [name, spec] of Object.entries(entries)) result.set(name, `${section}:${String(spec)}`);
  }
  return result;
}
async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}
/** A name npm accepts, from the project's name. */
export function npmName(projectName: string): string {
  return (
    projectName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'proyecto'
  );
}
