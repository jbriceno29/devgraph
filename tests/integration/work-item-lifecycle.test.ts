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

/** Writes one file per run in the worktree, like a well-behaved agent. */
class WritingAdapter implements AgentAdapterPort {
  readonly providerId = 'codex' as const;
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
    writeFileSync(join(input.workingDirectory, 'src', 'done.ts'), 'export const done = true;\n');
    yield { type: 'EXECUTION_FINISHED', timestamp: new Date().toISOString(), summary: 'Wrote src/done.ts' };
  }
  async cancel(): Promise<void> {}
  async respondToApproval(): Promise<void> {}
}

describe('work item lifecycle through the workspace core (Stage 1)', () => {
  it('blocks a task until its dependency is done, then commits the run on its branch and moves the task to IN_REVIEW', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-lifecycle-'));
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
    const revisions: number[] = [];
    const core = createWorkspaceCore(
      workspaceRoot,
      (channel, payload) => {
        if (channel === 'graph:revision_updated') revisions.push((payload as { revision: number }).revision);
      },
      { agentAdapter: new WritingAdapter() },
    );
    cores.push(core);
    const project = (await core.handle({
      channel: 'project:create',
      args: [{ name: 'Lifecycle', slug: 'lifecycle' }],
    })) as { id: string };
    const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
    await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
    const db = openDatabase({
      filename: join(workspaceRoot, 'projects', project.id, 'workspace.sqlite'),
      initialize: false,
    });
    try {
      for (const [id, key, title] of [
        ['t1', 'TASK-001', 'Create schema'],
        ['t2', 'TASK-002', 'Use schema'],
      ]) {
        db.prepare(
          `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'WORK_ITEM',?,?,'s','READY',?,1,1,'now','now')`,
        ).run(id, project.id, key, title, opened.selectedEntityId);
        db.prepare(
          `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
        ).run(id);
      }
      db.prepare(
        `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('e1',?,'t2','t1','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
      ).run(project.id);
    } finally {
      closeDatabase(db);
    }
    const developer = (
      (await core.handle({ channel: 'agent:list_profiles', args: [project.id] })) as Array<{
        id: string;
        roleKey: string;
      }>
    ).find(item => item.roleKey === 'DEVELOPER')!;
    await expect(
      core.handle({
        channel: 'execution:start',
        args: [{ projectId: project.id, workItemId: 't2', profileId: developer.id }],
      }),
    ).rejects.toThrow('TASK-001 (READY)');

    const started = (await core.handle({
      channel: 'execution:start',
      args: [{ projectId: project.id, workItemId: 't1', profileId: developer.id }],
    })) as { id: string; baseBranch: string | null; branchOrWorktree: string };
    // A task without a feature gets its own integration branch, created from the checked-out branch without switching it.
    expect(started.baseBranch).toBe('feature/task-001-create-schema');
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('main');
    let done: { status: string; initialCommit: string; finalCommit: string | null } | undefined;
    for (let attempt = 0; attempt < 100 && done?.status !== 'COMPLETED'; attempt += 1) {
      done = (
        (await core.handle({ channel: 'execution:list', args: [project.id] })) as Array<{
          id: string;
          status: string;
          initialCommit: string;
          finalCommit: string | null;
        }>
      ).find(item => item.id === started.id);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    expect(done!.status).toBe('COMPLETED');
    expect(done!.finalCommit).not.toBe(done!.initialCommit);
    expect(
      execFileSync('git', ['log', '-1', '--format=%s', done!.finalCommit!], { cwd: repo, encoding: 'utf8' }).trim(),
    ).toBe('TASK-001: Create schema');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe('');
    const graph = (await core.handle({ channel: 'graph:get_view', args: [project.id] })) as {
      nodes: Array<{ id: string; status: string }>;
      revision: number;
    };
    expect(graph.nodes.find(node => node.id === 't1')!.status).toBe('IN_REVIEW');
    expect(revisions.length).toBe(2);
    expect(graph.revision).toBe(revisions.at(-1));
  });
});

describe('operating without touching the database (Stage 1.3)', () => {
  it('changes task status by hand within the rules, exposes the allowed changes and edits the execution policy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-operate-'));
    roots.push(root);
    const workspaceRoot = join(root, 'workspace');
    const core = createWorkspaceCore(workspaceRoot, () => undefined, { agentAdapter: new WritingAdapter() });
    cores.push(core);
    const project = (await core.handle({
      channel: 'project:create',
      args: [{ name: 'Operate', slug: 'operate' }],
    })) as { id: string };
    const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
    const db = openDatabase({
      filename: join(workspaceRoot, 'projects', project.id, 'workspace.sqlite'),
      initialize: false,
    });
    try {
      for (const [id, key, status] of [
        ['t1', 'TASK-001', 'DRAFT'],
        ['t2', 'TASK-002', 'DRAFT'],
      ]) {
        db.prepare(
          `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'WORK_ITEM',?,'T','s',?,?,1,1,'now','now')`,
        ).run(id, project.id, key, status, opened.selectedEntityId);
        db.prepare(
          `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
        ).run(id);
      }
      db.prepare(
        `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('e1',?,'t2','t1','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
      ).run(project.id);
    } finally {
      closeDatabase(db);
    }
    const set = (id: string, status: string) =>
      core.handle({ channel: 'workitem:set_status', args: [project.id, id, status] });
    const inspector = async (id: string) =>
      core.handle({ channel: 'entity:get_inspector_details', args: [id] }) as Promise<{
        entity: { status: string };
        allowedStatusChanges?: string[];
      }>;

    expect((await inspector('t1')).allowedStatusChanges).toEqual(['READY', 'BLOCKED', 'ARCHIVED']);
    expect(await set('t2', 'BLOCKED')).toMatchObject({ status: 'BLOCKED' });
    expect((await inspector(opened.selectedEntityId)).allowedStatusChanges).toBeUndefined();
    await expect(set('t2', 'READY')).rejects.toThrow('TASK-001 (DRAFT)');
    await expect(set('t1', 'DONE')).rejects.toThrow('a mano');
    expect(await set('t1', 'READY')).toMatchObject({ status: 'READY' });
    expect((await inspector('t1')).allowedStatusChanges).toEqual(['BLOCKED', 'ARCHIVED']);

    const policy = (await core.handle({ channel: 'policy:get', args: [project.id] })) as {
      writablePaths: string[];
      allowedCommands: string[];
    };
    expect(policy.writablePaths).toContain('src/**');
    expect(policy.allowedCommands).toEqual([]);
    const saved = (await core.handle({
      channel: 'policy:update',
      args: [
        project.id,
        {
          ...policy,
          writablePaths: ['src/**', '  package.json ', 'src/**'],
          readonlyPaths: [],
          deniedPaths: ['.env*'],
          allowedCommands: ['node --test'],
        },
      ],
    })) as { writablePaths: string[]; readonlyPaths: string[]; deniedPaths: string[]; allowedCommands: string[] };
    expect(saved).toEqual({
      writablePaths: ['src/**', 'package.json'],
      readonlyPaths: [],
      deniedPaths: ['.env*'],
      allowedCommands: ['node --test'],
      maxExecutionMinutes: 30,
      maxTurns: 0,
      decisionPolicy: {
        rules: {
          NEW_TASK: 'AUTO',
          TASK_DEPENDENCY: 'AUTO',
          TASK_STATUS: 'ASK',
          DECISION_RECORD: 'ASK',
          SCOPE_CHANGE: 'ASK',
        },
        maxAutoTasksPerFeature: 5,
      },
    });
    await expect(
      core.handle({ channel: 'policy:update', args: [project.id, { ...saved, maxExecutionMinutes: 0 }] }),
    ).rejects.toThrow('entre 1 y 240');
    await expect(
      core.handle({ channel: 'policy:update', args: [project.id, { ...saved, maxTurns: -1 }] }),
    ).rejects.toThrow('0 (sin límite) y 1000');
    expect(
      await core.handle({ channel: 'policy:update', args: [project.id, { ...saved, maxTurns: 60 }] }),
    ).toMatchObject({ maxTurns: 60 });
    expect(
      await core.handle({ channel: 'policy:update', args: [project.id, { ...saved, maxTurns: null }] }),
    ).toMatchObject({ maxTurns: 0 });
    expect(await core.handle({ channel: 'policy:get', args: [project.id] })).toEqual(saved);
    await expect(
      core.handle({ channel: 'policy:update', args: [project.id, { ...saved, allowedCommands: ['npm test | tail'] }] }),
    ).rejects.toThrow('Comando no permitido');
    await expect(
      core.handle({ channel: 'policy:update', args: [project.id, { ...saved, writablePaths: ['../outside/**'] }] }),
    ).rejects.toThrow('Usa rutas relativas');
  });
});
