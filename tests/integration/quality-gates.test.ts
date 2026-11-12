import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';
import type { ReviewInput } from '../../src/infrastructure/ai/change-review-contract.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Behaviour = 'good' | 'delete-test';
/** Writes src/<task>.txt (its content says whether it was a revision); `delete-test` also removes the repository's test. */
class GateAdapter implements AgentAdapterPort {
  readonly providerId = 'claude-code' as const;
  prompts: string[] = [];
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
    this.prompts.push(input.prompt);
    const revision = input.prompt.includes('La revisión independiente encontró problemas');
    writeFileSync(join(input.workingDirectory, 'src', 'TASK-001.txt'), revision ? 'fixed\n' : 'first\n');
    if (this.behaviour === 'delete-test') rmSync(join(input.workingDirectory, 'src', 'base.test.ts'));
    yield { type: 'EXECUTION_FINISHED', timestamp: new Date().toISOString(), summary: '**Hecho** TASK-001.' };
  }
  async cancel(): Promise<void> {}
  async respondToApproval(): Promise<void> {}
}

async function setup(behaviour: Behaviour, verdicts: Array<{ approved: boolean; findings: string[] }> = []) {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-gates-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.name', 'Graphdev Tests'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'tests@graphdev.local'], { cwd: repo });
  writeFileSync(join(repo, 'check.mjs'), "console.log('checks ok');\n");
  writeFileSync(join(repo, 'src', 'base.test.ts'), 'a test\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo });
  const reviews: Array<{ input: ReviewInput; model: string }> = [];
  const adapter = new GateAdapter(behaviour);
  const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, {
    agentAdapter: adapter,
    changeReviewer: {
      review: async (input, model) => {
        reviews.push({ input, model });
        return verdicts.shift() ?? { approved: true, findings: [] };
      },
    },
  });
  cores.push(core);
  const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Gates', slug: 'gates' }] })) as {
    id: string;
  };
  const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
  await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
  const db = openDatabase({
    filename: join(root, 'workspace', 'projects', project.id, 'workspace.sqlite'),
    initialize: false,
  });
  try {
    const insert = db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`,
    );
    insert.run('mod', project.id, 'MODULE', 'MOD-001', 'M', '', 'DRAFT', opened.selectedEntityId);
    db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
    insert.run('feat', project.id, 'FEATURE', 'FEAT-001', 'Gates', '', 'DRAFT', 'mod');
    db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
    insert.run(
      't1',
      project.id,
      'WORK_ITEM',
      'TASK-001',
      'Escribir el archivo',
      'Crea src/TASK-001.txt',
      'READY',
      'feat',
    );
    db.prepare(
      `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES('t1','TASK','HIGH','["El archivo dice fixed"]','DEVELOPER')`,
    ).run();
  } finally {
    closeDatabase(db);
  }
  const policy = (await core.handle({ channel: 'policy:get', args: [project.id] })) as Record<string, unknown>;
  await core.handle({
    channel: 'policy:update',
    args: [project.id, { ...policy, writablePaths: ['src/**'], allowedCommands: ['node check.mjs'] }],
  });
  const pilot = (command: string, ...args: unknown[]) =>
    core.handle({ channel: `pilot:${command}` as never, args: [project.id, 'feat', ...args] });
  const until = async (
    done: (value: {
      run: { status: string; reason: string | null } | null;
      events: Array<{ kind: string; message: string }>;
    }) => boolean,
  ) => {
    const started = Date.now();
    for (;;) {
      const value = (await pilot('get')) as {
        run: { status: string; reason: string | null } | null;
        events: Array<{ kind: string; message: string }>;
        tasks: Array<{ status: string }>;
      };
      if (done(value)) return value;
      if (Date.now() - started > 20_000) throw new Error(`timeout ${JSON.stringify(value.run)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const model = (
    (await core.handle({ channel: 'agent:list_profiles', args: [project.id] })) as Array<{
      roleKey: string;
      availableModels: string[];
    }>
  ).find(profile => profile.roleKey === 'DEVELOPER')!.availableModels[0]!;
  return { core, projectId: project.id, pilot, until, git, reviews, adapter, model };
}

describe('quality gates the agent does not write (plan S5)', () => {
  it('a run that deletes a test completes but is not accepted on its own; the review shows why', async () => {
    const { core, projectId, pilot, until } = await setup('delete-test');
    await pilot('set_autonomy', { level: 'PILOT' });
    await pilot('start', { acknowledgeCost: true });
    const waiting = await until(value => value.run?.status === 'WAITING_USER');
    expect(waiting.run!.reason).toContain('puede haber debilitado su propia verificación');
    expect(waiting.run!.reason).toContain('Borra pruebas: src/base.test.ts');
    const execution = (
      (await core.handle({ channel: 'execution:list', args: [projectId] })) as Array<{
        status: string;
        qualityFlags?: string[];
      }>
    )[0]!;
    expect(execution).toMatchObject({ status: 'COMPLETED', qualityFlags: ['Borra pruebas: src/base.test.ts'] });
  });

  it('with a review model, a rejection becomes a revision with the findings; the approved revision is accepted', async () => {
    const { pilot, until, reviews, adapter, git, model } = await setup('good', [
      { approved: false, findings: ['El archivo no dice fixed (src/TASK-001.txt).'] },
    ]);
    await expect(pilot('set_autonomy', { level: 'PILOT', reviewModel: 'nope' })).rejects.toThrow('no está disponible');
    await pilot('set_autonomy', { level: 'PILOT', reviewModel: model });
    await pilot('start', { acknowledgeCost: true });
    const done = await until(value => ['COMPLETED', 'WAITING_USER'].includes(value.run?.status ?? ''));
    expect(done.run!.status, done.run!.reason ?? '').toBe('COMPLETED');
    expect(done.events.map(event => event.kind)).toEqual([
      'STARTED',
      'TASK_STARTED',
      'REVIEW_REJECTED',
      'REVIEW_APPROVED',
      'TASK_ACCEPTED',
      'COMPLETED',
    ]);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      model,
      input: {
        tasks: [{ key: 'TASK-001', criteria: ['El archivo dice fixed'] }],
        files: [expect.objectContaining({ path: 'src/TASK-001.txt' })],
      },
    });
    expect(adapter.prompts[1]).toContain('El archivo no dice fixed');
    expect(git('show', 'feature/feat-001-gates:src/TASK-001.txt')).toBe('fixed');
  });

  it('stops for the user when the review keeps rejecting', async () => {
    const no = { approved: false, findings: ['Falta el criterio.'] };
    const { pilot, until, model } = await setup('good', [no, no]);
    await pilot('set_autonomy', { level: 'PILOT', reviewModel: model, maxAttempts: 2 });
    await pilot('start', { acknowledgeCost: true });
    const waiting = await until(value => value.run?.status === 'WAITING_USER');
    expect(waiting.run!.reason).toContain('no pasó la revisión tras 2 intentos');
    expect(waiting.run!.reason).toContain('Falta el criterio.');
  });
});
