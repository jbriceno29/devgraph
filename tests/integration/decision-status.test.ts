import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFoundationPlan } from '../../src/application/inception/foundation-plan.js';
import { ChangeSetValidator } from '../../src/application/planning/changeset-validator.js';
import type { KnowledgeEntity } from '../../src/domain/graph/knowledge-entity.js';
import type { ChangeSet } from '../../src/domain/knowledge/change-set.js';
import {
  DECISION_STATUS_RULE,
  canTransitionDecision,
  decisionTransitions,
} from '../../src/domain/knowledge/decision-status.js';
import { buildPlannerPrompt } from '../../src/infrastructure/ai/change-set-planning-contract.js';
import { createWorkspaceCore } from '../../src/infrastructure/ipc/sidecar/workspace-core.js';
import { proposal } from './inception-fixtures.js';

const dirs: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(async () => {
  for (const core of cores.splice(0)) core.close?.();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const entity = (id: string, type: KnowledgeEntity['entityType'], status: string): KnowledgeEntity => ({
  id,
  projectId: 'p',
  entityType: type,
  displayKey: id.toUpperCase(),
  title: id,
  parentId: null,
  status,
  summary: '',
  createdRevision: 1,
  updatedRevision: 1,
  createdAt: 'now',
  updatedAt: 'now',
});
const changeSet = (operations: ChangeSet['operations']): ChangeSet => ({
  id: 'cs',
  projectId: 'p',
  baseGraphRevision: 1,
  originType: 'AI_CHAT',
  title: 't',
  rationale: 'r',
  status: 'PENDING_APPROVAL',
  operations,
  validationIssues: [],
  createdAt: 'now',
});

describe('decision records (ADR) lifecycle', () => {
  it('allows draft → accepted/rejected, accepted → superseded/draft, rejected → draft, and nothing from superseded', () => {
    expect(decisionTransitions('DRAFT')).toEqual(['ACCEPTED', 'REJECTED']);
    expect(decisionTransitions('ACCEPTED')).toEqual(['SUPERSEDED', 'DRAFT']);
    expect(decisionTransitions('REJECTED')).toEqual(['DRAFT']);
    expect(decisionTransitions('SUPERSEDED')).toEqual([]);
    expect(decisionTransitions('READY')).toEqual([]);
    expect(canTransitionDecision('DRAFT', 'DONE')).toBe(false);
    expect(DECISION_STATUS_RULE).toContain('DRAFT→ACCEPTED|REJECTED');
  });

  it('proposals: the validator refuses invalid ADR statuses and the planner is told the rule', () => {
    const graph = [entity('root', 'PROJECT_ROOT', 'ACTIVE'), entity('adr', 'DECISION_RECORD', 'DRAFT')];
    const validator = new ChangeSetValidator();
    const status = (newStatus: string) =>
      validator.validate(
        changeSet([{ type: 'UPDATE_ENTITY_STATUS', entityId: 'adr', newStatus, reason: 'x' }]),
        1,
        graph,
        [],
      );
    expect(status('ACCEPTED').status).toBe('VALIDATED');
    const wrong = status('DONE');
    expect(wrong.status).toBe('PENDING_APPROVAL');
    expect(wrong.issues[0]).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(wrong.issues[0]!.message).toContain('se permite: ACCEPTED, REJECTED');
    const prompt = buildPlannerPrompt({
      prompt: 'x',
      project: { name: 'p', description: null, rules: [] },
      entities: [],
      relationships: [],
    } as unknown as Parameters<typeof buildPlannerPrompt>[0]);
    expect(prompt).toContain(DECISION_STATUS_RULE);
  });

  it('the foundation plan accepts its ADRs: approving the plan is the decision', () => {
    const operations = proposal().map(op =>
      op.type === 'CREATE_RELATIONSHIP' && op.targetId === 'ROOT' ? { ...op, targetId: 'root' } : op,
    );
    const adrs = operations.filter(op => op.type === 'CREATE_DECISION_RECORD');
    expect(adrs.length).toBeGreaterThan(0);
    const plan = buildFoundationPlan(operations, 'root');
    for (const adr of adrs)
      expect(plan.operations).toContainEqual(
        expect.objectContaining({ type: 'UPDATE_ENTITY_STATUS', entityId: adr.tempId, newStatus: 'ACCEPTED' }),
      );
  });

  it('the inspector offers the transitions and decision:set_status changes it, bumping the revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphdev2-decision-'));
    dirs.push(root);
    const events: Array<[string, unknown]> = [];
    const core = createWorkspaceCore(root, (channel, payload) => events.push([channel, payload]));
    cores.push(core);
    const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Adr', slug: 'adr' }] })) as {
      id: string;
    };
    await core.handle({ channel: 'project:open', args: [project.id] });
    const db = new Database(join(root, 'projects', project.id, 'workspace.sqlite'));
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES('adr-1',?,'DECISION_RECORD','ADR-001','Usar SQLite','','DRAFT',NULL,1,1,?,?)`,
    ).run(project.id, now, now);
    db.prepare(
      `INSERT INTO decision_records(entity_id,adr_number,context_md,alternatives_md,decision_md,consequences_md,relative_path,content_hash,sync_status,decided_at) VALUES('adr-1',1,'','','','','docs/adr-001.md','h','SYNCED','2000-01-01T00:00:00.000Z')`,
    ).run();
    const revision = () =>
      (db.prepare('SELECT current_revision FROM projects WHERE id=?').get(project.id) as { current_revision: number })
        .current_revision;
    const before = revision();
    const details = (await core.handle({ channel: 'entity:get_inspector_details', args: ['adr-1'] })) as {
      allowedStatusChanges?: string[];
    };
    expect(details.allowedStatusChanges).toEqual(['ACCEPTED', 'REJECTED']);
    await expect(
      core.handle({ channel: 'decision:set_status', args: [project.id, 'adr-1', 'SUPERSEDED'] }),
    ).rejects.toThrow('ADR-001 está en borrador: solo puede pasar a aceptada o rechazada.');
    const result = await core.handle({ channel: 'decision:set_status', args: [project.id, 'adr-1', 'ACCEPTED'] });
    expect(result).toEqual({ status: 'ACCEPTED', revision: before + 1 });
    expect(revision()).toBe(before + 1);
    expect(db.prepare('SELECT decided_at FROM decision_records WHERE entity_id=?').get('adr-1')).not.toEqual({
      decided_at: '2000-01-01T00:00:00.000Z',
    });
    expect(events).toContainEqual(['graph:revision_updated', { projectId: project.id, revision: before + 1 }]);
    await expect(
      core.handle({ channel: 'decision:set_status', args: [project.id, 'missing', 'ACCEPTED'] }),
    ).rejects.toThrow('La decisión no existe en este proyecto.');
    db.close();
  });
});
