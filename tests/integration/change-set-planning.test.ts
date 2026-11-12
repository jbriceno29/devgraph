import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeOperation } from '../../src/domain/knowledge/change-set.js';
import type { ChangeSetPlannerPort, ChangeSetDraft } from '../../src/application/ports/change-set-planning-port.js';
import { ChangeSetPlanningService } from '../../src/application/planning/change-set-planning-service.js';
import { CodexChangeSetPlanner } from '../../src/infrastructure/ai/codex-change-set-planner.js';
import { SqliteChangeSetRepository } from '../../src/infrastructure/persistence/repositories/sqlite-change-set-repository.js';
import { SqliteKnowledgeGraphRepository } from '../../src/infrastructure/persistence/repositories/sqlite-knowledge-graph-repository.js';
import { SqliteProjectRepository } from '../../src/infrastructure/persistence/repositories/sqlite-project-repository.js';
import { SqliteRepositoryLocationRepository } from '../../src/infrastructure/persistence/repositories/sqlite-repository-location-repository.js';
import { SqliteChangeSetApplier } from '../../src/infrastructure/persistence/sqlite/sqlite-change-set-applier.js';
import { TransactionalMarkdownFileStore } from '../../src/infrastructure/filesystem/transactional-markdown-file-store.js';
import { CreateProjectUseCase } from '../../src/application/projects/create-project.js';
import { SqliteUnitOfWork } from '../../src/infrastructure/persistence/sqlite/unit-of-work.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';

const tempDirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function plannedOperations(path = 'docs/feature/spec.md'): ChangeOperation[] {
  return [
    {
      type: 'CREATE_MODULE',
      tempId: '$module',
      parentId: 'root',
      title: 'Identity',
      summary: 'Identity capability',
      purpose: 'Own identity behavior',
    },
    {
      type: 'CREATE_FEATURE',
      tempId: '$feature',
      moduleId: '$module',
      title: 'Sign in',
      summary: 'Authenticate a member',
      scope: 'Web sign in',
      priority: 'HIGH',
    },
    {
      type: 'CREATE_REQUIREMENT',
      tempId: '$requirement',
      parentId: 'root',
      title: 'Credential validation',
      summary: 'Reject invalid credentials',
      reqType: 'FUNCTIONAL',
      priority: 'HIGH',
      acceptanceCriteria: ['Invalid credentials are rejected'],
    },
    {
      type: 'CREATE_WORK_ITEM',
      tempId: '$task',
      parentId: '$feature',
      workType: 'TASK',
      title: 'Build sign in form',
      summary: 'Create the sign in UI',
      acceptanceCriteria: ['Form submits credentials'],
    },
    {
      type: 'UPSERT_ARTIFACT',
      tempId: '$spec',
      parentId: 'root',
      artifactType: 'SPEC',
      title: 'Sign in specification',
      relativePath: path,
      markdownContent: '# Sign in\n\nFunctional scope.',
    },
    { type: 'CREATE_RELATIONSHIP', sourceId: '$feature', targetId: '$requirement', edgeType: 'SATISFIES' },
  ];
}
const fakePlanner = (operations = plannedOperations()): ChangeSetPlannerPort => ({
  propose: async () => ({ title: 'Plan sign in', rationale: 'Add a coherent authentication slice.', operations }),
});
function setup() {
  const db = openDatabase({ filename: ':memory:' }),
    projects = new SqliteProjectRepository(db),
    graph = new SqliteKnowledgeGraphRepository(db),
    changes = new SqliteChangeSetRepository(db),
    repositories = new SqliteRepositoryLocationRepository(db),
    files = new TransactionalMarkdownFileStore(),
    projectId = 'planning-project';
  new CreateProjectUseCase(new SqliteUnitOfWork(db), projects).execute({
    project: {
      id: projectId,
      name: 'Planning Project',
      slug: 'planning-project',
      rules: ['Preserve local-first behavior'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    rootEntityId: 'root',
  });
  const service = (planner: ChangeSetPlannerPort, repositoryPath: string | null) =>
    new ChangeSetPlanningService(
      projects,
      graph,
      changes,
      planner,
      new SqliteChangeSetApplier(db, files, repositories),
      () => repositoryPath,
    );
  return { db, projects, graph, changes, repositories, files, projectId, service };
}
async function setupRepository() {
  const path = await mkdtemp(join(tmpdir(), 'graphdev2-changeset-'));
  tempDirs.push(path);
  execFileSync('git', ['init', '--quiet', path]);
  await mkdir(join(path, 'docs'), { recursive: true });
  return path;
}

describe('AI planning and transactional ChangeSets', () => {
  it('proposes and validates a multi-operation ChangeSet, resolves tempIds, writes Markdown, and bumps one graph revision', async () => {
    const root = await setupRepository(),
      f = setup();
    try {
      f.repositories.setPrimary(f.projectId, root);
      const proposal = await f.service(fakePlanner(), root).propose(f.projectId, 'Plan sign in');
      expect(proposal.status).toBe('VALIDATED');
      expect(proposal.operations.map(op => op.type)).toEqual(
        expect.arrayContaining([
          'CREATE_FEATURE',
          'CREATE_REQUIREMENT',
          'UPSERT_ARTIFACT',
          'CREATE_WORK_ITEM',
          'CREATE_RELATIONSHIP',
        ]),
      );
      const applied = await f.service(fakePlanner(), root).apply(proposal.id);
      expect(applied.revision).toBe(2);
      expect(Object.keys(applied.changeSet).length).toBeGreaterThan(0);
      expect(f.projects.findById(f.projectId)?.currentRevision).toBe(2);
      expect(f.graph.listEntities(f.projectId).map(entity => entity.entityType)).toEqual(
        expect.arrayContaining(['MODULE', 'FEATURE', 'REQUIREMENT', 'WORK_ITEM', 'ARTIFACT']),
      );
      const feature = f.graph.listEntities(f.projectId).find(entity => entity.title === 'Sign in')!,
        requirement = f.graph.listEntities(f.projectId).find(entity => entity.title === 'Credential validation')!;
      expect(f.graph.listRelationships(f.projectId)).toContainEqual(
        expect.objectContaining({
          sourceId: feature.id,
          targetId: requirement.id,
          edgeType: 'SATISFIES',
          provenance: 'CHANGESET',
        }),
      );
      expect(await readFile(join(root, 'docs/feature/spec.md'), 'utf8')).toContain('Functional scope.');
      expect(f.changes.findById(proposal.id)?.status).toBe('APPLIED');
      expect(
        f.db
          .prepare(
            'SELECT body_content FROM fts_knowledge_index WHERE entity_id=(SELECT id FROM knowledge_entities WHERE title=?)',
          )
          .get('Sign in specification'),
      ).toEqual({ body_content: '# Sign in\n\nFunctional scope.' });
    } finally {
      closeDatabase(f.db);
    }
  });

  it('rolls back SQLite and removes staged Markdown when an intermediate database write fails', async () => {
    const root = await setupRepository(),
      f = setup();
    try {
      f.repositories.setPrimary(f.projectId, root);
      const proposal = await f.service(fakePlanner(), root).propose(f.projectId, 'Plan sign in');
      expect(proposal.status).toBe('VALIDATED');
      f.db.exec(
        `CREATE TRIGGER reject_document_link BEFORE INSERT ON graph_edges WHEN NEW.edge_type='DOCUMENTED_BY' BEGIN SELECT RAISE(ABORT,'injected commit failure'); END;`,
      );
      await expect(f.service(fakePlanner(), root).apply(proposal.id)).rejects.toThrow('injected commit failure');
      await expect(readFile(join(root, 'docs/feature/spec.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(f.projects.findById(f.projectId)?.currentRevision).toBe(1);
      expect(f.graph.listEntities(f.projectId)).toHaveLength(1);
      expect(f.changes.findById(proposal.id)?.status).toBe('VALIDATED');
      expect(
        await import('node:fs/promises').then(fs => fs.readdir(join(root, 'docs', 'feature'))).catch(() => []),
      ).toEqual([]);
    } finally {
      closeDatabase(f.db);
    }
  });

  it('marks a proposal conflicted when its optimistic base revision is stale and rejects DAG cycles', async () => {
    const f = setup();
    try {
      const service = f.service(fakePlanner(), null),
        proposal = await service.propose(f.projectId, 'Plan sign in');
      f.db.prepare('UPDATE projects SET current_revision=2 WHERE id=?').run(f.projectId);
      await expect(service.apply(proposal.id)).rejects.toThrow(/conflicto/i);
      expect(f.changes.findById(proposal.id)?.status).toBe('CONFLICTED');
      expect(f.graph.listEntities(f.projectId)).toHaveLength(1);
      const cycle = plannedOperations();
      cycle.splice(1, 0, {
        type: 'CREATE_FEATURE',
        tempId: '$feature2',
        moduleId: '$module',
        title: 'Recovery',
        summary: 'Recovery',
        scope: 'Recovery',
        priority: 'MEDIUM',
      });
      cycle.push(
        { type: 'CREATE_RELATIONSHIP', sourceId: '$feature', targetId: '$feature2', edgeType: 'DEPENDS_ON' },
        { type: 'CREATE_RELATIONSHIP', sourceId: '$feature2', targetId: '$feature', edgeType: 'DEPENDS_ON' },
      );
      const invalid = await f.service(fakePlanner(cycle), null).propose(f.projectId, 'Create cycle');
      expect(invalid.status).toBe('PENDING_APPROVAL');
      expect(
        invalid.validationIssues.some(issue => issue.code === 'INVALID_RELATIONSHIP' && issue.message.includes('DAG')),
      ).toBe(true);
    } finally {
      closeDatabase(f.db);
    }
  });

  it('revalidates stored open proposals: issues from rules fixed since no longer block them, UI spec problems stay', async () => {
    const root = await setupRepository(),
      f = setup();
    try {
      f.repositories.setPrimary(f.projectId, root);
      const service = f.service(fakePlanner(), root),
        proposal = await service.propose(f.projectId, 'Plan sign in');
      expect(proposal.status).toBe('VALIDATED');
      const stale = {
        operationIndex: 0,
        severity: 'ERROR' as const,
        code: 'INVALID_RELATIONSHIP',
        message: 'AFFECTS is not allowed from DECISION_RECORD to ARTIFACT.',
      };
      f.changes.save({ ...proposal, status: 'PENDING_APPROVAL', validationIssues: [stale] });
      const listed = service.list(f.projectId).find(item => item.id === proposal.id)!;
      expect(listed).toMatchObject({ status: 'VALIDATED', validationIssues: [] });
      expect(f.changes.findById(proposal.id)?.status).toBe('VALIDATED');
      const uiSpec = { operationIndex: -1, severity: 'ERROR' as const, code: 'UI_SPEC_MISSING', message: 'Falta.' };
      f.changes.save({ ...proposal, status: 'PENDING_APPROVAL', validationIssues: [stale, uiSpec] });
      expect(service.find(proposal.id)).toMatchObject({ status: 'PENDING_APPROVAL', validationIssues: [uiSpec] });
      f.changes.save({ ...proposal, status: 'PENDING_APPROVAL', validationIssues: [stale] });
      expect((await service.apply(proposal.id)).changeSet.status).toBe('APPLIED');
    } finally {
      closeDatabase(f.db);
    }
  });

  it('passes the sealed ContextSnapshot package through the application port to the planner', async () => {
    const f = setup();
    let receivedContext: string | undefined;
    try {
      const planner: ChangeSetPlannerPort = {
        propose: async input => {
          receivedContext = input.contextPackage;
          return {
            title: 'Context-aware plan',
            rationale: 'Respect the sealed project context.',
            operations: [
              {
                type: 'CREATE_MODULE',
                tempId: '$module',
                parentId: 'root',
                title: 'Identity',
                summary: '',
                purpose: 'Identity behavior',
              },
            ],
          };
        },
      };
      const result = await f
        .service(planner, null)
        .propose(
          f.projectId,
          'Add identity',
          undefined,
          '<ContextSnapshot><Source id="policy" tier="1">Keep secrets private</Source></ContextSnapshot>',
        );
      expect(result.status).toBe('VALIDATED');
      expect(receivedContext).toContain('Keep secrets private');
    } finally {
      closeDatabase(f.db);
    }
  });

  it('Codex adapter consumes the CLI structured output without granting write access', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'graphdev2-codex-fixture-'));
    tempDirs.push(dir);
    const executable = join(dir, 'codex'),
      output: ChangeSetDraft = {
        title: 'Fixture plan',
        rationale: 'Structured read-only output',
        operations: plannedOperations(),
      };
    await writeFile(
      executable,
      `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = "--output-last-message" ]; then shift; OUT="$1"; fi\n shift\ndone\n/bin/cat >/dev/null\n/bin/cat > "$OUT" <<'JSON'\n${JSON.stringify(output)}\nJSON\n`,
    );
    execFileSync('chmod', ['+x', executable]);
    vi.stubEnv('PATH', dir);
    const draft = await new CodexChangeSetPlanner(dir).propose({
      prompt: 'Plan sign in',
      project: { name: 'Fixture', description: null, rules: [], revision: 1 },
      focusEntity: null,
      entities: [],
      relationships: [],
    });
    expect(draft).toEqual(output);
  });

  it('reports how to configure Codex when it is absent from PATH and standard locations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'graphdev2-no-codex-'));
    tempDirs.push(dir);
    vi.stubEnv('PATH', dir);
    await expect(
      new CodexChangeSetPlanner(dir, 'codex-not-installed').propose({
        prompt: 'Plan',
        project: { name: 'Fixture', description: null, rules: [], revision: 1 },
        focusEntity: null,
        entities: [],
        relationships: [],
      }),
    ).rejects.toThrow(/GRAPHDEV_CODEX_PATH/);
  });
});
