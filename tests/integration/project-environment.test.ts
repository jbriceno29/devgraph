import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import { NpmEnvironment } from '../../src/infrastructure/execution/npm-environment.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A stand-in for npm: records its arguments, adds the requested packages to package.json ("^1.0.0"), writes a lockfile
 * listing every declared package and creates node_modules/<package>/index.js for each. No network, no real installs.
 */
const FAKE_NPM = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, (require('node:path').basename(process.argv[1]) === 'fake-pnpm' ? 'pnpm ' : '') + args.join(' ') + '\\n');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const names = args.slice(1).filter(arg => !arg.startsWith('-'));
if (args[0] === 'install' && names.length) {
  const section = args.includes('--save-dev') ? 'devDependencies' : 'dependencies';
  manifest[section] = { ...(manifest[section] || {}) };
  for (const name of names) manifest[section][name] = '^1.0.0';
  fs.writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\\n');
}
const all = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
if (args[0] === 'ci' && !fs.existsSync('package-lock.json')) { console.error('npm ci needs a lockfile'); process.exit(1); }
if (args[0] !== 'ci') fs.writeFileSync('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: all }, null, 2) + '\\n');
for (const name of Object.keys(all)) { fs.mkdirSync('node_modules/' + name, { recursive: true }); fs.writeFileSync('node_modules/' + name + '/index.js', 'module.exports = 1;\\n'); }
`;

type Behaviour = 'good' | 'unapproved' | 'npmrc';
/** Writes src/<task>.txt; `unapproved` also adds left-pad to package.json, `npmrc` writes an .npmrc. */
class EnvironmentAdapter implements AgentAdapterPort {
  readonly providerId = 'codex' as const;
  inputs: AgentRunInput[] = [];
  skillPresent: boolean[] = [];
  constructor(private readonly behaviour: Behaviour) {}
  getCapabilities(): AgentCapabilities {
    return {
      supportsResume: false,
      supportsStreaming: true,
      supportsApprovals: false,
      supportsCancellation: true,
      supportsStructuredOutput: true,
      supportsWorktrees: true,
    };
  }
  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    this.inputs.push(input);
    this.skillPresent.push(existsSync(join(input.workingDirectory, '.claude', 'skills', 'impeccable', 'SKILL.md')));
    const key = /TASK-\d+/.exec(/# WorkItem\n([^\n]+)/.exec(input.prompt)?.[1] ?? '')?.[0] ?? 'task';
    writeFileSync(join(input.workingDirectory, 'src', `${key}.txt`), 'ok\n');
    if (this.behaviour === 'unapproved') {
      const path = join(input.workingDirectory, 'package.json'),
        manifest = JSON.parse(readFileSync(path, 'utf8'));
      manifest.dependencies = { ...manifest.dependencies, 'left-pad': '^1.3.0' };
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    }
    if (this.behaviour === 'npmrc')
      writeFileSync(join(input.workingDirectory, '.npmrc'), 'registry=https://example.invalid/\n');
    yield { type: 'EXECUTION_FINISHED', timestamp: new Date().toISOString(), summary: `**Hecho** ${key}.` };
  }
  async cancel(): Promise<void> {}
  async respondToApproval(): Promise<void> {}
}

async function setup(
  behaviour: Behaviour,
  tasks: Array<[string, string, string]> = [['t1', 'TASK-001', 'READY']],
  titles: Record<string, string> = {},
  /** profile null: an existing repository with these files (plan S2 for projects without a catalog profile). */
  options: { profile?: string | null; files?: Record<string, string> } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-environment-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.name', 'Graphdev Tests'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'tests@graphdev.local'], { cwd: repo });
  // The check proves the dependencies are really there when it runs; no .gitignore on purpose: node_modules must stay out of the commit anyway.
  writeFileSync(
    join(repo, 'check.mjs'),
    "import { existsSync } from 'node:fs';\nif (!existsSync('node_modules/react/index.js')) { console.error('react is not installed'); process.exit(1); }\nconsole.log('checks ok');\n",
  );
  writeFileSync(join(repo, 'src', 'base.txt'), 'ok\n');
  for (const [file, content] of Object.entries(options.files ?? {})) writeFileSync(join(repo, file), content);
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo });
  const npm = join(root, 'fake-npm');
  writeFileSync(npm, FAKE_NPM);
  chmodSync(npm, 0o755);
  const pnpm = join(root, 'fake-pnpm');
  writeFileSync(pnpm, FAKE_NPM);
  chmodSync(pnpm, 0o755);
  const npmLog = join(root, 'npm.log');
  writeFileSync(npmLog, '');
  const workspaceRoot = join(root, 'workspace');
  const adapter = new EnvironmentAdapter(behaviour);
  const core = createWorkspaceCore(workspaceRoot, () => undefined, {
    agentAdapter: adapter,
    // The same stand-in plays pnpm under another name: it logs «pnpm …» so the tests see which manager ran.
    environmentInstaller: new NpmEnvironment({ npm, pnpm, environment: { ...process.env, FAKE_NPM_LOG: npmLog } }),
    skillsDirectory: join(process.cwd(), 'skills'),
  });
  cores.push(core);
  const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Notas', slug: 'notas' }] })) as {
    id: string;
  };
  const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
  await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
  const db = openDatabase({
    filename: join(workspaceRoot, 'projects', project.id, 'workspace.sqlite'),
    initialize: false,
  });
  try {
    if (options.profile !== null)
      db.prepare('UPDATE projects SET stack_profile_id=? WHERE id=?').run(
        options.profile ?? 'web-spa-react',
        project.id,
      );
    const insert = db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`,
    );
    insert.run('mod', project.id, 'MODULE', 'MOD-001', 'M', '', 'DRAFT', opened.selectedEntityId);
    db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
    insert.run('feat', project.id, 'FEATURE', 'FEAT-001', 'Notas', '', 'DRAFT', 'mod');
    db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
    for (const [id, key, status] of tasks) {
      insert.run(id, project.id, 'WORK_ITEM', key, titles[id] ?? `${key} work`, 's', status, 'feat');
      db.prepare(
        `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
      ).run(id);
    }
    if (tasks.length > 1)
      db.prepare(
        `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('e1',?,'t2','t1','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
      ).run(project.id);
  } finally {
    closeDatabase(db);
  }
  const policy = (await core.handle({ channel: 'policy:get', args: [project.id] })) as Record<string, unknown>;
  await core.handle({
    channel: 'policy:update',
    args: [
      project.id,
      {
        ...policy,
        writablePaths: ['src/**', 'package.json', 'package-lock.json', '.npmrc'],
        allowedCommands: ['node check.mjs'],
      },
    ],
  });
  const pilot = (command: string, ...args: unknown[]) =>
    core.handle({ channel: `pilot:${command}` as never, args: [project.id, 'feat', ...args] });
  const status = () =>
    pilot('get') as Promise<{
      run: { status: string; reason: string | null } | null;
      events: Array<{ kind: string; message: string }>;
      tasks: Array<{ displayKey: string; status: string }>;
    }>;
  const until = async (predicate: (value: Awaited<ReturnType<typeof status>>) => boolean, timeout = 20_000) => {
    const started = Date.now();
    for (;;) {
      const value = await status();
      if (predicate(value)) return value;
      if (Date.now() - started > timeout) throw new Error(`timeout: ${JSON.stringify(value.run)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const npmCalls = () => readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean);
  await pilot('set_autonomy', { level: 'PILOT', maxAttempts: 1 });
  return { core, projectId: project.id, adapter, pilot, until, git, npmCalls, workspaceRoot };
}

describe('dependencies managed by the app (plan S2)', () => {
  it('installs the profile in each fresh worktree before the agent runs, keeps node_modules out of the audit and the commits, and tells the agent', async () => {
    const { pilot, until, git, npmCalls, adapter, workspaceRoot, projectId } = await setup('good', [
      ['t1', 'TASK-001', 'READY'],
      ['t2', 'TASK-002', 'BLOCKED'],
    ]);
    await pilot('start', { acknowledgeCost: true });
    const done = await until(value => value.run?.status === 'COMPLETED' || value.run?.status === 'WAITING_USER');
    expect(done.run!.status, done.run!.reason ?? '').toBe('COMPLETED');
    const calls = npmCalls();
    // First run: no package.json yet → the app creates it and adds the profile's packages (scripts never run). Second run: the lockfile exists → npm ci.
    expect(calls[0]).toMatch(
      /^install --save-prod --ignore-scripts --no-audit --no-fund --loglevel=error react react-dom$/,
    );
    expect(calls[1]).toMatch(/^install --save-dev --ignore-scripts .* typescript vite /);
    expect(calls[2]).toBe('ci --ignore-scripts --no-audit --no-fund --loglevel=error');
    const branch = 'feature/feat-001-notas';
    expect(git('log', '--format=%s', `main..${branch}`).split('\n')).toEqual([
      'TASK-002: TASK-002 work',
      'TASK-001: TASK-001 work',
    ]);
    const files = git('ls-tree', '-r', '--name-only', branch).split('\n');
    expect(files).toEqual(
      expect.arrayContaining(['package.json', 'package-lock.json', 'src/TASK-001.txt', 'src/TASK-002.txt']),
    );
    expect(files.some(file => file.startsWith('node_modules/'))).toBe(false);
    expect(JSON.parse(git('show', `${branch}:package.json`)).dependencies).toEqual({
      react: '^1.0.0',
      'react-dom': '^1.0.0',
    });
    expect(adapter.inputs[0]!.prompt).toContain('# Entorno del proyecto');
    expect(adapter.inputs[0]!.policy!.readonlyPaths).toContain('node_modules');
    // With the environment installed the agent may also run the project's scripts; acceptance still rests on the verification commands.
    expect(adapter.inputs[0]!.policy!.allowedCommands).toEqual(
      expect.arrayContaining(['node check.mjs', 'npm run', 'npm test']),
    );
    expect(adapter.inputs[0]!.prompt).toContain('`npm run` y `npm test`');
    expect(adapter.inputs[0]!.prompt).toContain('sin tuberías, redirecciones');
    const executions = await (cores[0]!.handle({ channel: 'execution:list', args: [projectId] }) as Promise<
      Array<{ id: string }>
    >);
    expect(
      executions.some(execution =>
        existsSync(join(workspaceRoot, 'projects', projectId, 'executions', execution.id, 'environment.log')),
      ),
    ).toBe(true);
  });

  it('stops for a package outside the profile, without retrying; once approved, the app installs it and the run passes', async () => {
    const { core, projectId, pilot, until, npmCalls } = await setup('unapproved');
    await pilot('set_autonomy', { level: 'PILOT', maxAttempts: 3 });
    await pilot('start', { acknowledgeCost: true });
    const waiting = await until(value => value.run?.status === 'WAITING_USER');
    expect(waiting.run!.reason).toContain('necesita paquetes que no están aprobados: left-pad');
    expect(waiting.events.filter(event => event.kind === 'TASK_STARTED')).toHaveLength(1);
    const failed = (
      (await core.handle({ channel: 'execution:list', args: [projectId] })) as Array<{
        status: string;
        pendingPackages?: string[];
        resultSummary: string;
      }>
    )[0]!;
    expect(failed).toMatchObject({
      status: 'FAILED',
      pendingPackages: ['left-pad'],
      resultSummary: expect.stringContaining('Dependencias sin aprobar: left-pad'),
    });
    await expect(
      core.handle({ channel: 'environment:approve_dependencies', args: [projectId, ['Left Pad']] }),
    ).rejects.toThrow('no válidos');
    const environment = await core.handle({
      channel: 'environment:approve_dependencies',
      args: [projectId, ['left-pad']],
    });
    expect(environment).toMatchObject({
      stackProfile: { id: 'web-spa-react' },
      installs: true,
      approvedPackages: ['left-pad'],
    });
    await pilot('resume');
    const done = await until(
      value =>
        value.run?.status === 'COMPLETED' ||
        (value.run?.status === 'WAITING_USER' &&
          value.events.filter(event => event.kind === 'TASK_STARTED').length > 1),
    );
    expect(done.run!.status, done.run!.reason ?? '').toBe('COMPLETED');
    // After the agent added the approved package, the app reinstalled (plain install, which updates the lockfile).
    expect(npmCalls().at(-1)).toBe('install --ignore-scripts --no-audit --no-fund --loglevel=error');
  });

  it('interface work carries the bundled Impeccable skill in its worktree, never in the commit; other work does not', async () => {
    const { core, projectId, pilot, until, git, adapter } = await setup(
      'good',
      [
        ['t1', 'TASK-001', 'READY'],
        ['t2', 'TASK-002', 'BLOCKED'],
      ],
      { t1: 'Guardar notas en localStorage', t2: 'Pantalla con la lista de notas' },
    );
    // Off by default (they cost 3–4.5× per interface task in the notas-spa measurement): the project turns them on.
    expect(await core.handle({ channel: 'environment:get', args: [projectId] })).toMatchObject({
      skillsEnabled: false,
      bundledSkills: [{ id: 'impeccable', license: 'Apache-2.0' }],
    });
    await expect(core.handle({ channel: 'environment:set_skills', args: [projectId, 'yes'] })).rejects.toThrow();
    expect(await core.handle({ channel: 'environment:set_skills', args: [projectId, true] })).toMatchObject({
      skillsEnabled: true,
    });
    await pilot('start', { acknowledgeCost: true });
    const done = await until(value => value.run?.status === 'COMPLETED' || value.run?.status === 'WAITING_USER');
    expect(done.run!.status, done.run!.reason ?? '').toBe('COMPLETED');
    expect(adapter.inputs.map(input => input.skills ?? [])).toEqual([[], ['impeccable']]);
    expect(adapter.skillPresent).toEqual([false, true]);
    expect(adapter.inputs[1]!.prompt).toContain('# Skills de la app');
    expect(adapter.inputs[1]!.prompt).toContain('docs/UI_SPEC.md (en lugar de DESIGN.md)');
    expect(adapter.inputs[1]!.policy!.readonlyPaths).toContain('.claude/skills/impeccable');
    expect(
      git('ls-tree', '-r', '--name-only', 'feature/feat-001-notas')
        .split('\n')
        .some(file => file.startsWith('.claude/')),
    ).toBe(false);
  });

  it('without turning skills on, interface work runs without them', async () => {
    const { pilot, until, adapter } = await setup('good', [['t1', 'TASK-001', 'READY']], {
      t1: 'Pantalla con la lista de notas',
    });
    await pilot('start', { acknowledgeCost: true });
    await until(value => value.run?.status === 'COMPLETED' || value.run?.status === 'WAITING_USER');
    expect(adapter.inputs[0]!.skills ?? []).toEqual([]);
    expect(adapter.skillPresent).toEqual([false]);
  });

  describe('a repository that follows no catalog profile', () => {
    const manifest = JSON.stringify({ name: 'existente', private: true, dependencies: { react: '^19.0.0' } });
    it('installs exactly its lockfile with npm ci, adds nothing, and tells the agent', async () => {
      const { pilot, until, npmCalls, adapter, git } = await setup(
        'good',
        undefined,
        {},
        { profile: null, files: { 'package.json': manifest, 'package-lock.json': '{"lockfileVersion":3}' } },
      );
      await pilot('start', { acknowledgeCost: true });
      const done = await until(value => value.run?.status === 'COMPLETED' || value.run?.status === 'WAITING_USER');
      expect(done.run!.status, done.run!.reason ?? '').toBe('COMPLETED');
      expect(npmCalls()).toEqual(['ci --ignore-scripts --no-audit --no-fund --loglevel=error']);
      expect(adapter.inputs[0]!.prompt).toContain('las dependencias que declara package.json');
      expect(JSON.parse(git('show', 'feature/feat-001-notas:package.json')).dependencies).toEqual({ react: '^19.0.0' });
    });
    it('uses pnpm when the repository has pnpm-lock.yaml', async () => {
      const { pilot, until, npmCalls, adapter } = await setup(
        'good',
        undefined,
        {},
        { profile: null, files: { 'package.json': manifest, 'pnpm-lock.yaml': 'lockfileVersion: 9\n' } },
      );
      await pilot('start', { acknowledgeCost: true });
      await until(value => value.run?.status === 'COMPLETED' || value.run?.status === 'WAITING_USER');
      expect(npmCalls()).toEqual(['pnpm install --frozen-lockfile --ignore-scripts --reporter=silent']);
      expect(adapter.inputs[0]!.policy!.allowedCommands).toEqual(expect.arrayContaining(['pnpm run', 'pnpm test']));
    });
    it('without a manifest installs nothing and leaves the prompt alone', async () => {
      const { pilot, until, npmCalls, adapter } = await setup('good', undefined, {}, { profile: null });
      await pilot('start', { acknowledgeCost: true });
      await until(value => ['COMPLETED', 'WAITING_USER'].includes(value.run?.status ?? ''));
      expect(npmCalls()).toEqual([]);
      expect(adapter.inputs[0]!.prompt).not.toContain('# Entorno del proyecto');
    });
    it('a yarn repository gets a clear message instead of a broken run', async () => {
      const { pilot, until } = await setup(
        'good',
        undefined,
        {},
        { profile: null, files: { 'package.json': manifest, 'yarn.lock': '# yarn' } },
      );
      await pilot('start', { acknowledgeCost: true });
      const waiting = await until(value => value.run?.status === 'WAITING_USER');
      expect(waiting.run!.reason).toContain('yarn');
    });
  });

  it("never lets the agent change npm's configuration", async () => {
    const { until, pilot } = await setup('npmrc');
    await pilot('start', { acknowledgeCost: true });
    const waiting = await until(value => value.run?.status === 'WAITING_USER');
    expect(waiting.run!.reason).toContain('.npmrc');
  });
});
