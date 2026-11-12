import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeInceptionEngine } from '../../src/modules/inception/infrastructure/claude-inception-engine.js';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import { ClaudeCodeAdapter } from '../../src/modules/execution/infrastructure/claude-code-adapter.js';
import { closeDatabase, openDatabase } from '../../src/platform/sqlite/database.js';
import type { InceptionViewDto } from '../../src/shared/contracts/inception-view.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
const savedPath = process.env.GRAPHDEV_CLAUDE_PATH;
const pids: number[] = [];
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const pid of pids.splice(0)) if (alive(pid)) process.kill(pid, 'SIGKILL');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (savedPath === undefined) delete process.env.GRAPHDEV_CLAUDE_PATH;
  else process.env.GRAPHDEV_CLAUDE_PATH = savedPath;
});

/** Fake `claude` that never answers: `polite` exits on SIGINT, `stubborn` ignores it (only SIGTERM stops it). Logs its pid and the signals it got. */
const FAKE = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const dir=__dirname,mode=fs.readFileSync(path.join(dir,'mode'),'utf8').trim(),args=process.argv.slice(2);
if(args[0]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true})+'\\n',()=>process.exit(0));return;}
process.on('SIGINT',()=>{fs.appendFileSync(path.join(dir,'signals'),'SIGINT\\n');if(mode==='polite')process.exit(130);});
process.on('SIGTERM',()=>{fs.appendFileSync(path.join(dir,'signals'),'SIGTERM\\n');process.exit(143);});
// The pid is the "ready" signal for the test: write it only once the handlers exist, or an early SIGINT kills the process unlogged.
fs.writeFileSync(path.join(dir,'pid'),String(process.pid));
process.stdin.resume();setInterval(()=>undefined,1000);
`;
function fake(mode: 'polite' | 'stubborn') {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-cancel-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'claude');
  writeFileSync(executable, FAKE);
  chmodSync(executable, 0o755);
  writeFileSync(join(bin, 'mode'), mode);
  // Waits for a complete pid (the file can exist and still be empty for an instant); never returns 0, which would mean "my process group" to kill().
  const readPid = () => (existsSync(join(bin, 'pid')) ? Number(readFileSync(join(bin, 'pid'), 'utf8')) : 0);
  const pid = async () => {
    let value = readPid();
    for (let i = 0; i < 500 && !(value > 0); i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      value = readPid();
    }
    if (!(value > 0)) throw new Error('the fake CLI never wrote its pid');
    pids.push(value);
    return value;
  };
  const gone = async (id: number, ms = 3000) => {
    const end = Date.now() + ms;
    while (alive(id) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
    return !alive(id);
  };
  const signals = () =>
    existsSync(join(bin, 'signals')) ? readFileSync(join(bin, 'signals'), 'utf8').trim().split('\n') : [];
  return { root, executable, pid, gone, signals };
}
const project = { name: 'P', description: null, brief: 'Algo', rootId: 'root' };

describe('cancelling an inception engine call', () => {
  it('the engine sends SIGINT, then SIGTERM after the grace period, and rejects as cancelled', async () => {
    const cli = fake('stubborn'),
      controller = new AbortController();
    const call = new ClaudeInceptionEngine(cli.root, { executable: cli.executable, cancelGraceMs: 150 }).askGoals({
      project,
      signal: controller.signal,
    });
    const pid = await cli.pid();
    controller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(await cli.gone(pid)).toBe(true);
    expect(cli.signals()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('an already aborted signal never starts the CLI', async () => {
    const cli = fake('polite'),
      controller = new AbortController();
    controller.abort();
    await expect(
      new ClaudeInceptionEngine(cli.root, { executable: cli.executable }).propose({
        project,
        questions: [],
        answers: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(join(cli.root, 'bin', 'pid'))).toBe(false);
  });

  async function core(cli: ReturnType<typeof fake>) {
    process.env.GRAPHDEV_CLAUDE_PATH = cli.executable;
    const workspace = join(cli.root, 'workspace'),
      instance = createWorkspaceCore(workspace, () => undefined, { agentAdapter: new ClaudeCodeAdapter() });
    cores.push(instance);
    const created = (await instance.handle({
      channel: 'project:create',
      args: [{ name: 'Cancelar', slug: 'cancelar' }],
    })) as { id: string };
    await instance.handle({ channel: 'project:open', args: [created.id] });
    const call = async <T>(channel: string, ...args: unknown[]) =>
      (await instance.handle({ channel: channel as never, args })) as T;
    return {
      instance,
      projectId: created.id,
      call,
      workspace,
      dbPath: join(workspace, 'projects', created.id, 'workspace.sqlite'),
    };
  }

  it('«Empezar de nuevo» stops the running CLI (no orphan) and the state goes back to the start, not to FAILED', async () => {
    const cli = fake('polite');
    const { instance, projectId, call } = await core(cli);
    expect(
      await call<InceptionViewDto>('inception:start', projectId, { brief: 'Una lista de tareas', model: 'haiku' }),
    ).toMatchObject({ status: 'WORKING' });
    const pid = await cli.pid();
    expect(await call<InceptionViewDto>('inception:restart', projectId)).toMatchObject({
      stage: 'NOT_STARTED',
      status: 'IDLE',
    });
    await instance.inceptionSettled(projectId);
    expect(await cli.gone(pid)).toBe(true);
    expect(cli.signals()).toEqual(['SIGINT']);
    expect(await call<InceptionViewDto>('inception:get', projectId)).toMatchObject({
      stage: 'NOT_STARTED',
      status: 'IDLE',
      error: null,
    });
  });

  it('closing the core stops the CLI; the stored call stays WORKING and reads as interrupted on the next open', async () => {
    const cli = fake('polite');
    const { instance, projectId, call, workspace, dbPath } = await core(cli);
    await call('inception:start', projectId, { brief: 'Una lista de tareas', model: 'haiku' });
    const pid = await cli.pid();
    instance.close();
    cores.splice(cores.indexOf(instance), 1);
    expect(await cli.gone(pid)).toBe(true);
    const db = openDatabase({ filename: dbPath, initialize: false });
    try {
      expect(db.prepare('SELECT status,error FROM project_inception').get()).toEqual({
        status: 'WORKING',
        error: null,
      });
    } finally {
      closeDatabase(db);
    }
    const reopened = createWorkspaceCore(workspace, () => undefined, { agentAdapter: new ClaudeCodeAdapter() });
    cores.push(reopened);
    expect(await reopened.handle({ channel: 'inception:get', args: [projectId] })).toMatchObject({
      status: 'FAILED',
      nextAction: 'RETRY_QUESTIONS',
      error: expect.stringMatching(/se interrumpió/),
    });
  });
});
