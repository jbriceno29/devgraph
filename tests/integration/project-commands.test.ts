import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type { CommandRunDto } from '../../src/shared/contracts/agent-view.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Stands in for npm: `run dev` prints a Vite-like banner and keeps running; `run test` passes; `run broken` fails; installs do nothing. */
const FAKE_NPM = `#!/usr/bin/env node
const [command, script] = process.argv.slice(2);
if (command !== 'run') process.exit(0);
if (script === 'dev') { console.log('\\u001b[32m  VITE ready\\u001b[0m'); console.log('  ➜  Local:   http://localhost:5173/'); setInterval(() => {}, 1000); }
else if (script === 'test') { console.log('2 passed (' + process.cwd().includes('/commands/') + ')'); }
else { console.error('boom'); process.exit(2); }
`;

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-commands-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.name', 'Graphdev Tests'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'tests@graphdev.local'], { cwd: repo });
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { dev: 'vite', test: 'vitest run', broken: 'exit 2', 'bad name;rm': 'x' } }),
  );
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo });
  execFileSync('git', ['branch', 'graphdev/feature/feat-001-x'], { cwd: repo });
  execFileSync('git', ['branch', 'graphdev/task-001-abcd'], { cwd: repo });
  const npm = join(root, 'fake-npm');
  writeFileSync(npm, FAKE_NPM);
  chmodSync(npm, 0o755);
  const events: Array<{ channel: string; payload: unknown }> = [];
  const workspaceRoot = join(root, 'workspace');
  const core = createWorkspaceCore(workspaceRoot, (channel, payload) => events.push({ channel, payload }), {
    commandExecutables: { npm },
  });
  cores.push(core);
  const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Cmd', slug: 'cmd' }] })) as {
    id: string;
  };
  await core.handle({ channel: 'project:open', args: [project.id] });
  await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
  const h = (channel: string, ...args: unknown[]) =>
    core.handle({ channel: channel as never, args: [project.id, ...args] });
  const until = async (runId: string, done: (run: CommandRunDto) => boolean) => {
    const started = Date.now();
    for (;;) {
      const run = ((await h('commands:list')) as CommandRunDto[]).find(item => item.id === runId)!;
      if (done(run)) return run;
      if (Date.now() - started > 15_000) throw new Error(`timeout: ${JSON.stringify(run)}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  return { h, until, events, workspaceRoot, projectId: project.id };
}

describe('project commands from the app', () => {
  it('lists the user branches and the safe script names of a branch', async () => {
    const { h } = await setup();
    expect(await h('commands:refs')).toEqual({ refs: ['main', 'graphdev/feature/feat-001-x'], current: 'main' });
    expect(await h('commands:scripts', 'graphdev/feature/feat-001-x')).toEqual({
      ref: 'graphdev/feature/feat-001-x',
      manager: 'npm',
      scripts: { dev: 'vite', test: 'vitest run', broken: 'exit 2' },
    });
    await expect(h('commands:scripts', 'graphdev/task-001-abcd')).rejects.toThrow('no existe');
  });

  it('runs a dev server in its own worktree, detects its URL, streams output, and stops it; the worktree goes away', async () => {
    const { h, until, events, workspaceRoot, projectId } = await setup();
    const started = (await h('commands:start', { ref: 'main', script: 'dev' })) as CommandRunDto;
    expect(started).toMatchObject({ status: 'PREPARING', command: 'npm run dev', ref: 'main' });
    const running = await until(started.id, run => run.url !== null);
    expect(running).toMatchObject({ status: 'RUNNING', url: 'http://localhost:5173/' });
    expect(running.output).toContain('VITE ready');
    expect(running.output).not.toContain('\u001b[');
    expect(events.some(event => event.channel === 'command:output')).toBe(true);
    await h('commands:stop', started.id);
    const stopped = await until(started.id, run => run.endedAt !== null);
    expect(stopped.status).toBe('STOPPED');
    const commandsDir = join(workspaceRoot, 'projects', projectId, 'commands');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(existsSync(commandsDir) ? readdirSync(commandsDir) : []).toEqual([]);
  });

  it('reports how a finished script ended, and refuses unknown or unsafe scripts', async () => {
    const { h, until } = await setup();
    const ok = (await h('commands:start', { ref: 'main', script: 'test' })) as CommandRunDto;
    expect(await until(ok.id, run => run.endedAt !== null)).toMatchObject({
      status: 'EXITED',
      exitCode: 0,
      output: expect.stringContaining('2 passed (true)'),
    });
    const bad = (await h('commands:start', { ref: 'main', script: 'broken' })) as CommandRunDto;
    expect(await until(bad.id, run => run.endedAt !== null)).toMatchObject({
      status: 'FAILED',
      exitCode: 2,
      output: expect.stringContaining('boom'),
    });
    await expect(h('commands:start', { ref: 'main', script: 'lint' })).rejects.toThrow('no tiene el script');
    await expect(h('commands:start', { ref: 'main', script: 'bad name;rm' })).rejects.toThrow('inválido');
  });
});
