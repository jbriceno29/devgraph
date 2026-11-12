import { afterEach, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/platform/sqlite/database.js';
import type {
  AgentAdapterPort,
  AgentRunInput,
} from '../../src/modules/execution/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/modules/execution/domain/models.js';

/** A project with a real Git repository, features and tasks written straight into the database, and a fake engine. */
const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Follows `WRITE <path> :: <content>` directives from the task summary and records which files each run saw on start. */
export class FileAdapter implements AgentAdapterPort {
  readonly providerId = 'codex' as const;
  seen: Array<{ title: string; files: string[] }> = [];
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
    const title = /# WorkItem\n([^\n]+)/.exec(input.prompt)?.[1] ?? '';
    const src = join(input.workingDirectory, 'src');
    this.seen.push({ title, files: existsSync(src) ? readdirSync(src).sort() : [] });
    const workItem = input.prompt.slice(input.prompt.indexOf('# WorkItem'), input.prompt.indexOf('# Criterios'));
    for (const match of workItem.matchAll(/WRITE (\S+) :: ([^\n]+)/g)) {
      const target = join(input.workingDirectory, match[1]!);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${match[2]}\n`);
    }
    yield { type: 'EXECUTION_FINISHED', timestamp: new Date().toISOString(), summary: `**Hecho** ${title}.` };
  }
  async cancel(): Promise<void> {}
  async respondToApproval(): Promise<void> {}
}

export type Spec = {
  features: Array<{ id: string; key: string; title: string }>;
  tasks: Array<{ id: string; key: string; feature: string; title: string; summary: string; status?: string }>;
  edges: Array<[string, string]>;
};

export async function setup(spec: Spec) {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-branches-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('config', 'user.name', 'Graphdev Tests');
  git('config', 'user.email', 'tests@graphdev.local');
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'scaffold');
  const workspaceRoot = join(root, 'workspace');
  const adapter = new FileAdapter();
  const core = createWorkspaceCore(workspaceRoot, () => undefined, { agentAdapter: adapter });
  cores.push(core);
  const project = (await core.handle({
    channel: 'project:create',
    args: [{ name: 'Branches', slug: 'branches' }],
  })) as { id: string };
  const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
  await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
  const withDb = <T>(work: (db: ReturnType<typeof openDatabase>) => T): T => {
    const db = openDatabase({
      filename: join(workspaceRoot, 'projects', project.id, 'workspace.sqlite'),
      initialize: false,
    });
    try {
      return work(db);
    } finally {
      closeDatabase(db);
    }
  };
  const addTask = (task: Spec['tasks'][number]) =>
    withDb(db => {
      db.prepare(
        `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'WORK_ITEM',?,?,?,?,?,1,1,'now','now')`,
      ).run(task.id, project.id, task.key, task.title, task.summary, task.status ?? 'READY', task.feature);
      db.prepare(
        `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
      ).run(task.id);
    });
  withDb(db => {
    const insert = db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`,
    );
    insert.run('mod', project.id, 'MODULE', 'MOD-001', 'App', '', 'DRAFT', opened.selectedEntityId);
    db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
    for (const feature of spec.features) {
      insert.run(feature.id, project.id, 'FEATURE', feature.key, feature.title, '', 'DRAFT', 'mod');
      db.prepare(`INSERT INTO features(entity_id,scope,priority) VALUES(?,'s','HIGH')`).run(feature.id);
    }
    for (const task of spec.tasks) {
      insert.run(
        task.id,
        project.id,
        'WORK_ITEM',
        task.key,
        task.title,
        task.summary,
        task.status ?? 'READY',
        task.feature,
      );
      db.prepare(
        `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
      ).run(task.id);
    }
    spec.edges.forEach(([source, target], index) =>
      db
        .prepare(
          `INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`,
        )
        .run(`e${index}`, project.id, source, target),
    );
  });
  const profileId = (
    (await core.handle({ channel: 'agent:list_profiles', args: [project.id] })) as Array<{
      id: string;
      roleKey: string;
    }>
  ).find(item => item.roleKey === 'DEVELOPER')!.id;
  const start = (workItemId: string) =>
    core.handle({ channel: 'execution:start', args: [{ projectId: project.id, workItemId, profileId }] }) as Promise<{
      id: string;
      status: string;
      resultSummary: string | null;
      baseBranch: string | null;
    }>;
  const runAndAccept = async (workItemId: string) => {
    const started = await start(workItemId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = (
        (await core.handle({ channel: 'execution:list', args: [project.id] })) as Array<{
          id: string;
          status: string;
          resultSummary: string | null;
        }>
      ).find(item => item.id === started.id)!;
      if (current.status === 'COMPLETED') break;
      if (['FAILED', 'CANCELLED'].includes(current.status))
        throw new Error(`${current.status}: ${current.resultSummary}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const accepted = (await core.handle({ channel: 'execution:accept', args: [started.id] })) as {
      merged: boolean;
      execution: { baseBranch: string };
    };
    expect(accepted.merged).toBe(true);
    return accepted;
  };
  const integrate = (featureId: string) =>
    core.handle({ channel: 'feature:integrate', args: [project.id, featureId] }) as Promise<{
      merged: boolean;
      alreadyIntegrated: boolean;
      branchName: string;
      targetBranch: string;
      commit: string;
    }>;
  const files = (ref: string) => git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean).sort();
  const branches = () => git('branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort();
  const mergeWorktrees = () => {
    const directory = join(workspaceRoot, 'projects', project.id, 'merges');
    return existsSync(directory) ? readdirSync(directory) : [];
  };
  return {
    core,
    repo,
    git,
    adapter,
    addTask,
    projectId: project.id,
    start,
    runAndAccept,
    integrate,
    files,
    branches,
    mergeWorktrees,
    withDb,
    workspaceRoot,
    rootId: opened.selectedEntityId,
  };
}

export const twoFeatures = (edges: Array<[string, string]>, extra: Spec['tasks'] = []): Spec => ({
  features: [
    { id: 'fa', key: 'FEAT-001', title: 'Fundación' },
    { id: 'fb', key: 'FEAT-002', title: 'Listado' },
  ],
  tasks: [
    {
      id: 'a1',
      key: 'TASK-001',
      feature: 'fa',
      title: 'Crear módulo a',
      summary: 'WRITE src/a.js :: export const a = 1;',
    },
    {
      id: 'b1',
      key: 'TASK-002',
      feature: 'fb',
      title: 'Usar módulo a',
      summary: 'WRITE src/b.js :: import { a } from "./a.js";',
    },
    ...extra,
  ],
  edges,
});
