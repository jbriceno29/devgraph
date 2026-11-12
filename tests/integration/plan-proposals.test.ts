import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/platform/sqlite/database.js';
import type {
  AgentAdapterPort,
  AgentRunInput,
} from '../../src/modules/execution/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/modules/execution/domain/models.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Writes one file per task and closes with a summary; `block` (raw text) is appended as the ```propuestas block. */
class ProposalAdapter implements AgentAdapterPort {
  readonly providerId = 'codex' as const;
  prompts: string[] = [];
  block: string | null = null;
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
    writeFileSync(join(input.workingDirectory, 'src', `run-${this.prompts.length}.ts`), 'export const done = true;\n');
    const proposal = this.block === null ? '' : `\n\n\`\`\`propuestas\n${this.block}\n\`\`\``;
    yield {
      type: 'EXECUTION_FINISHED',
      timestamp: new Date().toISOString(),
      summary: `**Hecho** Tarea cerrada.\n**Decisiones** Ninguna.\n**Convenciones** Ninguna.\n**Pendiente** Falta validar las tareas.${proposal}`,
    };
  }
  async cancel(): Promise<void> {}
  async respondToApproval(): Promise<void> {}
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-proposals-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.name', 'Graphdev Tests'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'tests@graphdev.local'], { cwd: repo });
  writeFileSync(join(repo, 'src', 'base.ts'), 'export const base = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo });
  const workspaceRoot = join(root, 'workspace');
  const adapter = new ProposalAdapter();
  const core = createWorkspaceCore(workspaceRoot, () => undefined, { agentAdapter: adapter });
  cores.push(core);
  const project = (await core.handle({
    channel: 'project:create',
    args: [{ name: 'Proposals', slug: 'proposals' }],
  })) as { id: string };
  const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
  await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
  const dbPath = join(workspaceRoot, 'projects', project.id, 'workspace.sqlite');
  const db = openDatabase({ filename: dbPath, initialize: false });
  try {
    const insert = db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`,
    );
    insert.run('mod', project.id, 'MODULE', 'MOD-001', 'Tareas', '', 'DRAFT', opened.selectedEntityId);
    db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
    insert.run('feat', project.id, 'FEATURE', 'FEAT-001', 'Gestión de tareas', '', 'DRAFT', 'mod');
    db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
    for (const [id, key, title, status] of [
      ['t1', 'TASK-001', 'Crear tareas', 'READY'],
      ['t2', 'TASK-002', 'Listar tareas', 'BLOCKED'],
    ]) {
      insert.run(id, project.id, 'WORK_ITEM', key, title, '', status, 'feat');
      db.prepare(
        `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
      ).run(id);
    }
    db.prepare(
      `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('d1',?,'t2','t1','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
    ).run(project.id);
  } finally {
    closeDatabase(db);
  }
  const profileId = (
    (await core.handle({ channel: 'agent:list_profiles', args: [project.id] })) as Array<{
      id: string;
      roleKey: string;
    }>
  ).find(item => item.roleKey === 'DEVELOPER')!.id;
  const runAndAccept = async (workItemId: string) => {
    const started = (await core.handle({
      channel: 'execution:start',
      args: [{ projectId: project.id, workItemId, profileId }],
    })) as { id: string };
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = (
        (await core.handle({ channel: 'execution:list', args: [project.id] })) as Array<{ id: string; status: string }>
      ).find(item => item.id === started.id)!;
      if (current.status === 'COMPLETED') break;
      if (['FAILED', 'CANCELLED'].includes(current.status)) throw new Error(current.status);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    return core.handle({ channel: 'execution:accept', args: [started.id] }) as Promise<{
      merged: boolean;
      proposal: { changeSetId: string | null; outcome: string; reasons: string[]; title: string } | null;
    }>;
  };
  const tasks = () => {
    const read = openDatabase({ filename: dbPath, initialize: false });
    try {
      return read
        .prepare(
          `SELECT id,display_key AS key,title,status,parent_id AS parentId FROM knowledge_entities WHERE project_id=? AND entity_type='WORK_ITEM' ORDER BY display_key`,
        )
        .all(project.id) as Array<{ id: string; key: string; title: string; status: string; parentId: string }>;
    } finally {
      closeDatabase(read);
    }
  };
  const changeSets = async () =>
    (await core.handle({ channel: 'changeset:list', args: [project.id] })) as Array<{
      id: string;
      status: string;
      originType: string;
      originRefId?: string;
    }>;
  return { core, projectId: project.id, rootId: opened.selectedEntityId, adapter, runAndAccept, tasks, changeSets };
}

const newTask = (tempId: string, title: string) => ({
  type: 'CREATE_WORK_ITEM',
  tempId,
  parentId: 'feat',
  workType: 'TASK',
  title,
  summary: 's',
  acceptanceCriteria: ['ok'],
});

describe('plan proposals from agents (Stage 3)', () => {
  it('applies a proposal the policy allows: new tasks land READY or BLOCKED, and the memory has no proposal block', async () => {
    const { core, adapter, runAndAccept, tasks, changeSets } = await setup();
    // $a depends on TASK-001 (done when accepted) → READY; $b depends on TASK-002 (still BLOCKED) → BLOCKED. Keys are accepted as ids.
    adapter.block = JSON.stringify({
      title: 'Validación de tareas',
      rationale: 'Falta validar.',
      operations: [
        newTask('$a', 'Validar tareas'),
        newTask('$b', 'Validar listado'),
        { type: 'CREATE_RELATIONSHIP', sourceId: '$a', targetId: 't1', edgeType: 'DEPENDS_ON' },
        { type: 'CREATE_RELATIONSHIP', sourceId: '$b', targetId: 'TASK-002', edgeType: 'DEPENDS_ON' },
      ],
    });
    const accepted = await runAndAccept('t1');
    expect(accepted.merged).toBe(true);
    expect(accepted.proposal).toMatchObject({ outcome: 'APPLIED', title: 'Validación de tareas', reasons: [] });

    const prompt = adapter.prompts[0]!;
    expect(prompt).toContain('# Plan de la feature\nFEAT-001 (id feat) Gestión de tareas');
    expect(prompt).toContain('- TASK-002 (id t2) [BLOCKED] Listar tareas — depende de TASK-001');
    expect(prompt).toContain('```propuestas');

    const byTitle = Object.fromEntries(tasks().map(task => [task.title, task]));
    expect(byTitle['Validar tareas']).toMatchObject({ status: 'READY', parentId: 'feat' });
    expect(byTitle['Validar listado']).toMatchObject({ status: 'BLOCKED', parentId: 'feat' });
    expect(byTitle['Listar tareas']!.status).toBe('READY');
    expect((await changeSets()).find(item => item.id === accepted.proposal!.changeSetId)).toMatchObject({
      status: 'APPLIED',
      originType: 'AGENT_EXECUTION',
    });

    const inspector = (await core.handle({ channel: 'entity:get_inspector_details', args: ['t1'] })) as {
      outcome: { summary: string };
    };
    expect(inspector.outcome.summary).toContain('**Pendiente** Falta validar las tareas.');
    expect(inspector.outcome.summary).not.toContain('propuestas');
    expect(inspector.outcome.summary).not.toContain('CREATE_WORK_ITEM');
  });

  it('leaves a scope change pending for the user', async () => {
    const { adapter, rootId, runAndAccept, tasks, changeSets } = await setup();
    adapter.block = JSON.stringify({
      title: 'Nuevo requisito',
      rationale: 'Cambia el alcance.',
      operations: [
        {
          type: 'CREATE_REQUIREMENT',
          tempId: '$r',
          parentId: rootId,
          title: 'Exportar tareas',
          summary: 's',
          reqType: 'FUNCTIONAL',
          priority: 'MEDIUM',
          acceptanceCriteria: [],
        },
      ],
    });
    const accepted = await runAndAccept('t1');
    expect(accepted.merged).toBe(true);
    expect(accepted.proposal?.outcome).toBe('PENDING');
    expect(accepted.proposal?.reasons.join(' ')).toContain('alcance');
    const stored = (await changeSets()).find(item => item.id === accepted.proposal!.changeSetId)!;
    expect(['VALIDATED', 'PENDING_APPROVAL']).toContain(stored.status);
    expect(stored.originType).toBe('AGENT_EXECUTION');
    expect(tasks()).toHaveLength(2);
  });

  it('asks once the agents would exceed the automatic task limit of the feature', async () => {
    const { core, projectId, adapter, runAndAccept, tasks } = await setup();
    const policy = (await core.handle({ channel: 'policy:get', args: [projectId] })) as {
      writablePaths: string[];
      readonlyPaths: string[];
      deniedPaths: string[];
      allowedCommands: string[];
      decisionPolicy: { rules: Record<string, string>; maxAutoTasksPerFeature: number };
    };
    await core.handle({
      channel: 'policy:update',
      args: [projectId, { ...policy, decisionPolicy: { ...policy.decisionPolicy, maxAutoTasksPerFeature: 1 } }],
    });
    adapter.block = JSON.stringify({
      title: 'Dos tareas',
      rationale: 'r',
      operations: [newTask('$a', 'Una'), newTask('$b', 'Otra')],
    });
    const accepted = await runAndAccept('t1');
    expect(accepted.proposal?.outcome).toBe('PENDING');
    expect(accepted.proposal?.reasons.join(' ')).toContain('el máximo es 1');
    expect(tasks()).toHaveLength(2);
  });

  it('never fails the acceptance over an invalid proposal', async () => {
    const { core, adapter, runAndAccept, tasks } = await setup();
    adapter.block = '{"title": "roto", operations: [';
    const accepted = await runAndAccept('t1');
    expect(accepted.merged).toBe(true);
    expect(accepted.proposal).toMatchObject({ outcome: 'INVALID', changeSetId: null });
    expect(accepted.proposal!.reasons[0]).toContain('JSON');
    expect(tasks().find(task => task.id === 't1')!.status).toBe('DONE');
    const inspector = (await core.handle({ channel: 'entity:get_inspector_details', args: ['t1'] })) as {
      outcome: { summary: string };
    };
    expect(inspector.outcome.summary).not.toContain('propuestas');
  });

  it('reports a proposal the validator rejects without applying it', async () => {
    const { adapter, runAndAccept, tasks } = await setup();
    // A task under a MODULE breaks the hierarchy: the ChangeSet is stored for review, never applied.
    adapter.block = JSON.stringify({
      title: 'Mal ubicada',
      rationale: 'r',
      operations: [{ ...newTask('$a', 'Fuera de lugar'), parentId: 'mod' }],
    });
    const accepted = await runAndAccept('t1');
    expect(accepted.merged).toBe(true);
    expect(accepted.proposal?.outcome).toBe('INVALID');
    expect(accepted.proposal?.changeSetId).not.toBeNull();
    expect(tasks()).toHaveLength(2);
  });

  it('accepts with no proposal when the agent writes no block', async () => {
    const { runAndAccept } = await setup();
    expect((await runAndAccept('t1')).proposal).toBeNull();
  });
});
