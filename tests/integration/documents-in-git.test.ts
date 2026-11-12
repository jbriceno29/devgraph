import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import { GitDocumentCommitter } from '../../src/infrastructure/git/git-document-committer.js';
import { TransactionalMarkdownFileStore } from '../../src/infrastructure/filesystem/transactional-markdown-file-store.js';
import { SqliteProjectRepository } from '../../src/infrastructure/persistence/repositories/sqlite-project-repository.js';
import { SqliteKnowledgeGraphRepository } from '../../src/infrastructure/persistence/repositories/sqlite-knowledge-graph-repository.js';
import { SqliteChangeSetRepository } from '../../src/infrastructure/persistence/repositories/sqlite-change-set-repository.js';
import { SqliteRepositoryLocationRepository } from '../../src/infrastructure/persistence/repositories/sqlite-repository-location-repository.js';
import { SqliteChangeSetApplier } from '../../src/infrastructure/persistence/sqlite/sqlite-change-set-applier.js';
import { ChangeSetPlanningService } from '../../src/application/planning/change-set-planning-service.js';
import { CreateProjectUseCase } from '../../src/application/projects/create-project.js';
import { SqliteUnitOfWork } from '../../src/infrastructure/persistence/sqlite/unit-of-work.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';
import type { ChangeOperation } from '../../src/domain/knowledge/change-set.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const sha = (content: string) => createHash('sha256').update(content).digest('hex');

function gitRepository() {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-docs-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'docs'));
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.name', 'Graphdev Tests'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'tests@graphdev.local'], { cwd: repo });
  writeFileSync(join(repo, 'src', 'base.ts'), 'export const base = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo });
  return { root, repo, git: (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim() };
}

describe('GitDocumentCommitter', () => {
  it('reports modified, deleted and untracked documents, and commits only the given paths', async () => {
    const { repo, git } = gitRepository();
    const committer = new GitDocumentCommitter();
    writeFileSync(join(repo, 'docs', 'a.md'), 'a\n');
    writeFileSync(join(repo, 'docs', 'b.md'), 'b\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'docs');
    writeFileSync(join(repo, 'docs', 'a.md'), 'a2\n');
    rmSync(join(repo, 'docs', 'b.md'));
    writeFileSync(join(repo, 'docs', 'c.md'), 'c\n');
    expect(await committer.uncommitted(repo, ['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/clean.md'])).toEqual([
      'docs/a.md',
      'docs/b.md',
      'docs/c.md',
    ]);
    writeFileSync(join(repo, 'src', 'staged.ts'), 'staged\n');
    git('add', 'src/staged.ts');
    const result = await committer.commit(repo, ['docs/c.md'], 'docs(graph): C');
    expect(result).toMatchObject({ committed: true, error: null });
    expect(git('show', '--name-only', '--format=%s', 'HEAD').split('\n')).toEqual(['docs(graph): C', '', 'docs/c.md']);
    expect(git('status', '--porcelain')).toContain('A  src/staged.ts');
    expect(await committer.commit(repo, ['docs/c.md'], 'again')).toMatchObject({ committed: false, error: null });
  });
});

describe('ChangeSet documents are committed (D6)', () => {
  function planning(repo: string) {
    const db = openDatabase({ filename: ':memory:' }),
      projects = new SqliteProjectRepository(db),
      graph = new SqliteKnowledgeGraphRepository(db),
      changes = new SqliteChangeSetRepository(db),
      repositories = new SqliteRepositoryLocationRepository(db);
    new CreateProjectUseCase(new SqliteUnitOfWork(db), projects).execute({
      project: { id: 'p', name: 'P', slug: 'p', rules: [], createdAt: 'now', updatedAt: 'now' },
      rootEntityId: 'root',
    });
    repositories.setPrimary('p', repo);
    const operations = [
      {
        type: 'UPSERT_ARTIFACT' as const,
        tempId: '$spec',
        parentId: 'root',
        artifactType: 'SPEC',
        title: 'Spec',
        relativePath: 'docs/spec.md',
        markdownContent: '# Spec\n',
      },
    ] as ChangeOperation[];
    const service = new ChangeSetPlanningService(
      projects,
      graph,
      changes,
      { propose: async () => ({ title: 'Add spec', rationale: 'r', operations }) },
      new SqliteChangeSetApplier(db, new TransactionalMarkdownFileStore(), repositories, new GitDocumentCommitter()),
      () => repo,
    );
    return { db, service };
  }
  it('commits exactly the written documents on the checked-out branch', async () => {
    const { repo, git } = gitRepository();
    const { db, service } = planning(repo);
    try {
      const proposal = await service.propose('p', 'Add a spec');
      await service.apply(proposal.id);
      expect(git('log', '-1', '--format=%s')).toBe(`docs(graph): Add spec [changeset ${proposal.id}]`);
      expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('docs/spec.md');
      expect(git('status', '--porcelain')).toBe('');
    } finally {
      closeDatabase(db);
    }
  });
  it('refuses to apply over a document with uncommitted changes and leaves it untouched', async () => {
    const { repo } = gitRepository();
    const { db, service } = planning(repo);
    try {
      writeFileSync(join(repo, 'docs', 'spec.md'), 'my local notes\n');
      const proposal = await service.propose('p', 'Add a spec');
      await expect(service.apply(proposal.id)).rejects.toThrow('docs/spec.md tiene cambios sin commitear');
      expect(readFileSync(join(repo, 'docs', 'spec.md'), 'utf8')).toBe('my local notes\n');
    } finally {
      closeDatabase(db);
    }
  });
});

describe('recovering an interrupted apply', () => {
  it('removes temp files and keeps or restores backups according to the database', async () => {
    const { repo } = gitRepository();
    const docs = join(repo, 'docs');
    const id = () => randomUUID();
    writeFileSync(join(docs, `.a.md.${id()}.tmp`), 'partial');
    writeFileSync(join(docs, `.b.md.${id()}.bak`), 'b old');
    writeFileSync(join(docs, 'c.md'), 'c new');
    writeFileSync(join(docs, `.c.md.${id()}.bak`), 'c old');
    writeFileSync(join(docs, 'd.md'), 'd new');
    writeFileSync(join(docs, `.d.md.${id()}.bak`), 'd old');
    const actions = await new TransactionalMarkdownFileStore().recoverInterruptedWrites(
      repo,
      new Map([
        ['docs/c.md', sha('c old')],
        ['docs/d.md', sha('d new')],
      ]),
    );
    expect(actions.map(action => `${action.action} ${action.path}`).sort()).toEqual([
      'removed-backup docs/d.md',
      'removed-temp docs/a.md',
      'restored-backup docs/b.md',
      'restored-backup docs/c.md',
    ]);
    expect(readFileSync(join(docs, 'b.md'), 'utf8')).toBe('b old');
    expect(readFileSync(join(docs, 'c.md'), 'utf8')).toBe('c old');
    expect(readFileSync(join(docs, 'd.md'), 'utf8')).toBe('d new');
    expect(readdirSync(docs).sort()).toEqual(['b.md', 'c.md', 'd.md']);
  });
});

/** Writes a file, and records whether the graph's documents were present in its worktree. */
class DocsProbeAdapter implements AgentAdapterPort {
  readonly providerId = 'codex' as const;
  seen: Array<{ prd: string | null }> = [];
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
    const prd = join(input.workingDirectory, 'docs', 'PRD.md');
    this.seen.push({ prd: existsSync(prd) ? readFileSync(prd, 'utf8') : null });
    writeFileSync(join(input.workingDirectory, 'src', `run-${this.seen.length}.ts`), 'export {};\n');
    yield { type: 'EXECUTION_FINISHED', timestamp: new Date().toISOString(), summary: 'ok' };
  }
  async cancel(): Promise<void> {}
  async respondToApproval(): Promise<void> {}
}

describe('executions see the graph documents (D6)', () => {
  it('commits app documents, blocks runs on uncommitted ones and brings the feature branch up to date', async () => {
    const { root, repo, git } = gitRepository();
    const adapter = new DocsProbeAdapter();
    const workspaceRoot = join(root, 'workspace');
    const core = createWorkspaceCore(workspaceRoot, () => undefined, { agentAdapter: adapter });
    cores.push(core);
    const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Docs', slug: 'docs' }] })) as {
      id: string;
    };
    const opened = (await core.handle({ channel: 'project:open', args: [project.id] })) as { selectedEntityId: string };
    await core.handle({ channel: 'repository:configure', args: [project.id, repo] });
    const db = openDatabase({
      filename: join(workspaceRoot, 'projects', project.id, 'workspace.sqlite'),
      initialize: false,
    });
    try {
      for (const [id, key] of [
        ['t1', 'TASK-001'],
        ['t2', 'TASK-002'],
      ]) {
        db.prepare(
          `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'FEATURE','FEAT-'||?,'F','s','DRAFT',?,1,1,'now','now') ON CONFLICT DO NOTHING`,
        ).run('feat', project.id, '001', opened.selectedEntityId);
        db.prepare(
          `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'WORK_ITEM',?,'T','s','READY','feat',1,1,'now','now')`,
        ).run(id, project.id, key);
        db.prepare(
          `INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`,
        ).run(id);
      }
    } finally {
      closeDatabase(db);
    }
    const profileId = (
      (await core.handle({ channel: 'agent:list_profiles', args: [project.id] })) as Array<{
        id: string;
        roleKey: string;
      }>
    ).find(item => item.roleKey === 'DEVELOPER')!.id;
    const run = async (workItemId: string) => {
      const started = (await core.handle({
        channel: 'execution:start',
        args: [{ projectId: project.id, workItemId, profileId }],
      })) as { id: string };
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = (
          (await core.handle({ channel: 'execution:list', args: [project.id] })) as Array<{
            id: string;
            status: string;
            baseBranch: string;
          }>
        ).find(item => item.id === started.id)!;
        if (current.status === 'COMPLETED') return current;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error('run did not complete');
    };

    // First run creates the feature branch before any document exists.
    const first = await run('t1');
    expect(adapter.seen[0]).toEqual({ prd: null });

    // A document created from the app is committed on the user's branch (main), not on the feature branch.
    const created = (await core.handle({
      channel: 'artifact:create',
      args: [
        {
          projectId: project.id,
          entityType: 'ARTIFACT',
          title: 'Product requirements',
          artifactType: 'PRD',
          targetEntityId: opened.selectedEntityId,
        },
      ],
    })) as { document: { id: string; contentHash: string }; content: string };
    expect(git('log', '-1', '--format=%s')).toBe('docs(graph): DOC-001 Product requirements');
    expect(git('status', '--porcelain')).toBe('');

    // Edited outside the app and not committed: runs are blocked until it is committed.
    writeFileSync(join(repo, 'docs', 'PRD.md'), `${created.content}\nLocal edit.\n`);
    await expect(
      core.handle({ channel: 'execution:start', args: [{ projectId: project.id, workItemId: 't2', profileId }] }),
    ).rejects.toThrow('Hay documentos del grafo sin commitear: docs/PRD.md');
    git('checkout', '--quiet', '--', 'docs/PRD.md');

    // The feature branch predates the document: it is merged up to date, so the agent finds the PRD.
    const second = await run('t2');
    expect(second.baseBranch).toBe(first.baseBranch);
    expect(adapter.seen[1]!.prd).toBe(created.content);
    expect(git('log', '--format=%s', '-1', first.baseBranch)).toBe(
      `Actualiza ${first.baseBranch} con los documentos de main`,
    );
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('status', '--porcelain')).toBe('');
  });
});
