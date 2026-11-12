import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WorkspaceEnvironmentPort } from '../../execution/index.js';
import type { ProjectEnvironment } from '../../projects/index.js';
import type { CommandRunDto, ProjectScriptsDto } from '../../../shared/contracts/agent-view.js';
import { git } from '../../execution/index.js';

/** Script names npm and pnpm accept as given, without shell meaning. */
const SCRIPT = /^[\w:.@/-]{1,80}$/;
/** Output kept per run (the tail); the renderer gets every chunk as it comes. */
const MAX_OUTPUT = 200_000;
const MAX_RUNNING = 4;
/** The first local URL a dev server prints (Vite, Next, CRA…), after removing colours. */
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"]*)?/;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

type Run = CommandRunDto & { child: ChildProcess | null; directory: string; repositoryRoot: string };

export interface ProjectCommandsOptions {
  workspaceRoot: string;
  installer: Pick<WorkspaceEnvironmentPort, 'provision'>;
  emit: (channel: 'command:updated' | 'command:output', payload: unknown) => void;
  /** Executables (tests point them at stand-ins). */
  npm?: string;
  pnpm?: string;
}

/**
 * The user's project commands (`npm test`, `npm run dev`, build…) on any branch, from the app: each run gets its own
 * detached worktree of that branch with the environment installed (as an agent run would), its output streamed, and
 * the dev server's URL detected. The user's checkout is never touched; the worktree is removed when the command ends.
 */
export class ProjectCommands {
  private readonly runs = new Map<string, Run>();
  constructor(private readonly options: ProjectCommandsOptions) {}

  /** Branches the user can run commands on: the user's own and the feature branches (never the agents' graphdev/ ones). */
  async refs(repositoryRoot: string): Promise<{ refs: string[]; current: string | null }> {
    const refs = (await git(repositoryRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
      .split('\n')
      .map(line => line.trim())
      .filter(ref => ref && !ref.startsWith('graphdev/'));
    const current =
      (await git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null;
    return {
      refs: [...(current && refs.includes(current) ? [current] : []), ...refs.filter(ref => ref !== current)],
      current,
    };
  }

  /** The scripts of package.json at `ref`, and the manager its lockfile names. */
  async scripts(repositoryRoot: string, ref: string): Promise<ProjectScriptsDto> {
    await this.checkRef(repositoryRoot, ref);
    const manifest = await git(repositoryRoot, ['show', `${ref}:package.json`]).catch(() => null);
    if (manifest === null) return { ref, manager: null, scripts: {} };
    let scripts: Record<string, string> = {};
    try {
      const parsed = JSON.parse(manifest) as { scripts?: unknown };
      if (parsed.scripts && typeof parsed.scripts === 'object')
        scripts = Object.fromEntries(
          Object.entries(parsed.scripts).filter(([name, value]) => SCRIPT.test(name) && typeof value === 'string'),
        ) as Record<string, string>;
    } catch {
      /* an unreadable manifest has no scripts */
    }
    const pnpm = await git(repositoryRoot, ['cat-file', '-e', `${ref}:pnpm-lock.yaml`]).then(
      () => true,
      () => false,
    );
    return { ref, manager: pnpm ? 'pnpm' : 'npm', scripts };
  }

  list(projectId: string): CommandRunDto[] {
    return [...this.runs.values()]
      .filter(run => run.projectId === projectId)
      .map(view)
      .reverse();
  }

  async start(input: {
    projectId: string;
    repositoryRoot: string;
    ref: string;
    script: string;
    environment: ProjectEnvironment | null;
  }): Promise<CommandRunDto> {
    if (!/^[0-9a-f-]{36}$/i.test(input.projectId)) throw new Error('Proyecto inválido.');
    if (!SCRIPT.test(input.script)) throw new Error(`Nombre de script inválido: ${input.script}`);
    const available = await this.scripts(input.repositoryRoot, input.ref);
    if (!(input.script in available.scripts))
      throw new Error(`La rama ${input.ref} no tiene el script «${input.script}» en package.json.`);
    if ([...this.runs.values()].filter(run => run.child && run.status === 'RUNNING').length >= MAX_RUNNING)
      throw new Error(`Ya hay ${MAX_RUNNING} comandos en marcha; detén alguno antes de lanzar otro.`);
    const id = randomUUID();
    const directory = join(this.options.workspaceRoot, 'projects', input.projectId, 'commands', id);
    const manager = available.manager ?? 'npm';
    const run: Run = {
      id,
      projectId: input.projectId,
      ref: input.ref,
      script: input.script,
      command: `${manager} run ${input.script}`,
      status: 'PREPARING',
      exitCode: null,
      url: null,
      output: '',
      startedAt: new Date().toISOString(),
      endedAt: null,
      child: null,
      directory,
      repositoryRoot: input.repositoryRoot,
    };
    this.runs.set(id, run);
    this.updated(run);
    void this.launch(run, manager, input.environment);
    return view(run);
  }

  async stop(runId: string): Promise<CommandRunDto> {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Ese comando ya no existe.');
    if (run.status === 'PREPARING' || run.status === 'RUNNING') {
      run.status = 'STOPPED';
      this.kill(run);
      this.updated(run);
    }
    return view(run);
  }

  /** App shutdown: no command outlives the app. */
  shutdown(): void {
    for (const run of this.runs.values()) if (run.child) this.kill(run);
  }

  private async launch(run: Run, manager: 'npm' | 'pnpm', environment: ProjectEnvironment | null): Promise<void> {
    try {
      await mkdir(dirname(run.directory), { recursive: true });
      await git(run.repositoryRoot, ['worktree', 'add', '--quiet', '--detach', run.directory, run.ref]);
      if (environment) {
        this.append(run, '— Preparando el entorno (dependencias)…\n');
        const prepared = await this.options.installer.provision({
          projectId: run.projectId,
          executionId: run.id,
          workingDirectory: run.directory,
          projectName: 'proyecto',
          environment,
        });
        this.append(run, `${prepared.log}\n`);
      }
      if (run.status === 'STOPPED') return await this.cleanup(run);
      this.append(run, `— $ ${run.command}\n`);
      const executable = (manager === 'pnpm' ? this.options.pnpm : this.options.npm) ?? manager;
      // Its own process group, so stopping it also stops what it spawned (Vite's esbuild, a test runner's workers…).
      const child = spawn(executable, ['run', run.script], {
        cwd: run.directory,
        detached: process.platform !== 'win32',
        env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', CI: process.env.CI ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      run.child = child;
      run.status = 'RUNNING';
      this.updated(run);
      const onData = (chunk: Buffer) => this.append(run, chunk.toString('utf8'));
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('error', error => this.append(run, `\n${error.message}\n`));
      child.once('close', code => {
        run.child = null;
        if (run.status === 'RUNNING') {
          run.status = code === 0 ? 'EXITED' : 'FAILED';
          run.exitCode = code;
        }
        run.endedAt = new Date().toISOString();
        this.updated(run);
        void this.cleanup(run);
      });
    } catch (error) {
      this.append(run, `\n${error instanceof Error ? error.message : String(error)}\n`);
      run.status = 'FAILED';
      run.endedAt = new Date().toISOString();
      this.updated(run);
      await this.cleanup(run);
    }
  }

  private append(run: Run, text: string): void {
    const clean = text.replace(ANSI, '');
    run.output = (run.output + clean).slice(-MAX_OUTPUT);
    if (!run.url) {
      const url = LOCAL_URL.exec(clean)?.[0] ?? null;
      if (url) {
        run.url = url.replace('0.0.0.0', 'localhost');
        this.updated(run);
      }
    }
    this.options.emit('command:output', { projectId: run.projectId, runId: run.id, chunk: clean });
  }

  private kill(run: Run): void {
    const child = run.child;
    if (!child?.pid) return;
    const signal = (name: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32') child.kill(name);
        else process.kill(-child.pid!, name);
      } catch {
        /* already gone */
      }
    };
    signal('SIGTERM');
    const timer = setTimeout(() => signal('SIGKILL'), 5_000);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }

  /** Removes the run's worktree (only ever the one it created, under the workspace's commands folder). */
  private async cleanup(run: Run): Promise<void> {
    await git(run.repositoryRoot, ['worktree', 'remove', '--force', run.directory]).catch(() => undefined);
    await rm(run.directory, { recursive: true, force: true }).catch(() => undefined);
    await git(run.repositoryRoot, ['worktree', 'prune']).catch(() => undefined);
  }

  private async checkRef(repositoryRoot: string, ref: string): Promise<void> {
    const { refs } = await this.refs(repositoryRoot);
    if (!refs.includes(ref)) throw new Error(`La rama ${ref} no existe en el repositorio.`);
  }

  private updated(run: Run): void {
    this.options.emit('command:updated', { projectId: run.projectId, run: view(run) });
  }
}

function view(run: Run): CommandRunDto {
  const { child: _child, directory: _directory, repositoryRoot: _root, ...dto } = run;
  return { ...dto };
}
