import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDatabase,
  closeDatabase,
  type SqliteDatabase,
} from '../../src/infrastructure/persistence/sqlite/database.js';
import { SqliteActivityRepository } from '../../src/infrastructure/persistence/repositories/sqlite-activity-repository.js';
import { ActivityService } from '../../src/application/activity/activity-service.js';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import type { ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';

const dbs: SqliteDatabase[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) closeDatabase(db);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seed() {
  const db = openDatabase({ filename: ':memory:' });
  dbs.push(db);
  db.prepare(
    "INSERT INTO projects(id,name,slug,created_at,updated_at) VALUES('p','Proyecto','proyecto','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')",
  ).run();
  db.prepare(
    `INSERT INTO agent_providers(id,provider_key,display_name,adapter_version,capabilities_json) VALUES('prov','claude-code','Claude','1','{}')`,
  ).run();
  db.prepare(
    `INSERT INTO agent_profiles(id,project_id,role_key,name,system_instructions) VALUES('dev','p','DEVELOPER','Dev','x')`,
  ).run();
  const entity = db.prepare(
    `INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,'p',?,?,?,?,?,1,1,?,?)`,
  );
  const at = (hour: number) => `2026-11-10T${String(hour).padStart(2, '0')}:00:00.000Z`;
  entity.run('feat', 'FEATURE', 'FEAT-001', 'Gestión de tareas', 'DRAFT', null, at(1), at(1));
  entity.run('feat2', 'FEATURE', 'FEAT-002', 'Informes', 'DRAFT', null, at(1), at(1));
  for (const [id, key, title, status, parent, hour] of [
    ['t1', 'TASK-001', 'Crear tareas', 'DONE', 'feat', 5],
    ['t2', 'TASK-002', 'Listar tareas', 'IN_PROGRESS', 'feat', 6],
    ['t3', 'TASK-003', 'Borrar tareas', 'READY', 'feat', 2],
    ['t4', 'TASK-004', 'Exportar informe', 'IN_REVIEW', 'feat2', 4],
    ['t5', 'TASK-005', 'Gráfica', 'READY', 'feat2', 3],
    ['t6', 'TASK-006', 'Borrador', 'DRAFT', 'feat2', 3],
  ] as const)
    entity.run(id, 'WORK_ITEM', key, title, status, parent, at(hour), at(hour));
  const execution = db.prepare(
    `INSERT INTO agent_executions(id,project_id,work_item_id,profile_id,provider_id,status,initial_commit,review_status,result_summary,started_at,completed_at) VALUES(?,'p',?,'dev','prov',?,'abc',?,?,?,?)`,
  );
  execution.run('e1-old', 't1', 'FAILED', null, 'falló', at(2), at(2));
  execution.run('e1', 't1', 'COMPLETED', 'ACCEPTED', '**Hecho** listo', at(4), at(5));
  execution.run('e2', 't2', 'RUNNING', null, null, at(6), null);
  execution.run('e4', 't4', 'COMPLETED', null, '**Hecho** Exportación a CSV con pruebas.', at(3), at(4));
  execution.run('e5', 't5', 'FAILED', null, 'Las pruebas no pasaron.', at(2), at(3));
  db.prepare(`INSERT INTO feature_autonomy(feature_id,project_id,level,updated_at) VALUES('feat','p','PILOT',?)`).run(
    at(1),
  );
  db.prepare(
    `INSERT INTO pilot_runs(id,project_id,feature_id,status,reason,started_at,ended_at) VALUES('run','p','feat','WAITING_USER','El agente propone cambios al plan que requieren tu decisión: Validación.',?,NULL)`,
  ).run(at(4));
  db.prepare(
    `INSERT INTO pilot_events(id,pilot_run_id,sequence_no,kind,message,work_item_id,execution_id,created_at) VALUES('ev','run',1,'WAITING_USER','espera','t1','e1',?)`,
  ).run(at(5));
  db.prepare(
    `INSERT INTO change_sets(id,project_id,base_graph_revision,origin_type,origin_ref_id,title,rationale,status,operations_json,created_at) VALUES('cs','p',1,'AGENT_EXECUTION','e1','Validación','r','PENDING_APPROVAL','[]',?)`,
  ).run(at(5));
  db.prepare(
    `INSERT INTO change_sets(id,project_id,base_graph_revision,origin_type,origin_ref_id,title,rationale,status,operations_json,created_at) VALUES('cs-chat','p',1,'AI_CHAT',NULL,'Del chat','r','PENDING_APPROVAL','[]',?)`,
  ).run(at(5));
  return { db, service: new ActivityService(new SqliteActivityRepository(db)) };
}
const byKind = (summary: ActivitySummaryDto, kind: string) => summary.items.filter(item => item.kind === kind);

describe('ActivityService', () => {
  it('derives what needs the user, what runs and what finished from the existing tables', () => {
    const { service } = seed();
    const summary = service.list('p');
    const attention = summary.items.filter(item => item.needsAttention);
    expect(attention.map(item => item.kind).sort()).toEqual([
      'PILOT_WAITING',
      'PLAN_PROPOSAL',
      'TASK_FAILED',
      'TASK_IN_REVIEW',
    ]);
    expect(summary.attentionCount).toBe(4);
    expect(summary.items.slice(0, 4).every(item => item.needsAttention)).toBe(true);
    // Attention sorted by date, newest first: proposal (05h) > pilot (04h) = review (04h) > failure (03h).
    expect(summary.items[0]).toMatchObject({
      kind: 'PLAN_PROPOSAL',
      changeSetId: 'cs',
      executionId: 'e1',
      workItemId: 't1',
      target: 'planning',
      title: 'Propuesta de cambios al plan: Validación',
    });
    expect(summary.items[0]!.detail).toContain('TASK-001');
    expect(byKind(summary, 'PILOT_WAITING')[0]).toMatchObject({
      featureId: 'feat',
      target: 'agents',
      detail: expect.stringContaining('propone cambios al plan'),
    });
    expect(byKind(summary, 'TASK_IN_REVIEW')[0]).toMatchObject({
      workItemId: 't4',
      executionId: 'e4',
      detail: 'Hecho Exportación a CSV con pruebas.',
    });
    expect(byKind(summary, 'TASK_FAILED')[0]).toMatchObject({
      workItemId: 't5',
      executionId: 'e5',
      detail: 'Las pruebas no pasaron.',
    });
    expect(summary.running).toEqual([{ workItemKey: 'TASK-002', title: 'Listar tareas' }]);
    expect(byKind(summary, 'TASK_RUNNING')[0]).toMatchObject({
      workItemId: 't2',
      executionId: 'e2',
      needsAttention: false,
    });
    // One entry per task: the finished one is not listed as ready too, drafts are left out, chat proposals are not agent work.
    expect(
      summary.items.filter(item => item.workItemId === 't1' && item.kind.startsWith('TASK_')).map(item => item.kind),
    ).toEqual(['TASK_DONE']);
    expect(byKind(summary, 'TASK_DONE')[0]).toMatchObject({
      target: 'graph',
      title: 'TASK-001 Crear tareas terminada',
    });
    expect(byKind(summary, 'TASK_READY').map(item => item.workItemId)).toEqual(['t3']);
    expect(summary.items.some(item => item.workItemId === 't6' || item.changeSetId === 'cs-chat')).toBe(false);
    expect(new Set(summary.items.map(item => item.id)).size).toBe(summary.items.length);
  });

  it('does not ask for a review or a retry the autopilot handles, and follows decisions already taken', () => {
    const { db, service } = seed();
    db.prepare("UPDATE pilot_runs SET status='RUNNING',reason=NULL").run();
    db.prepare("UPDATE change_sets SET status='APPLIED',applied_at='2026-11-10T07:00:00.000Z' WHERE id='cs'").run();
    db.prepare("UPDATE knowledge_entities SET parent_id='feat' WHERE id IN ('t4','t5')").run();
    const summary = service.list('p');
    expect(summary.attentionCount).toBe(0);
    expect(byKind(summary, 'TASK_IN_REVIEW')[0]!.detail).toContain('Se integrará sola');
    expect(byKind(summary, 'TASK_FAILED')[0]!.detail).toBe('El piloto volverá a intentarlo.');
    expect(byKind(summary, 'PLAN_CHANGED')[0]).toMatchObject({
      changeSetId: 'cs',
      target: 'graph',
      title: 'Plan actualizado: Validación',
    });
    expect(summary.items[0]!.kind).toBe('PLAN_CHANGED');
    expect(byKind(summary, 'PILOT_WAITING')).toEqual([]);
    expect(service.list('p', 2).items).toHaveLength(2);
  });

  it('lists pending approvals of a live execution as needing the user', () => {
    const { db, service } = seed();
    db.prepare("UPDATE agent_executions SET status='AWAITING_APPROVAL' WHERE id='e2'").run();
    db.prepare(
      `INSERT INTO approval_requests(id,execution_id,scope,requested_action,reason,status,requested_at) VALUES('ap','e2','COMMAND','npm install','Necesita una dependencia.','PENDING','2026-11-10T08:00:00.000Z')`,
    ).run();
    const approval = byKind(service.list('p'), 'APPROVAL_PENDING')[0];
    expect(approval).toMatchObject({
      id: 'APPROVAL_PENDING:ap',
      executionId: 'e2',
      approvalRequestId: 'ap',
      workItemId: 't2',
      needsAttention: true,
      target: 'agents',
      title: 'Un agente pide permiso en TASK-002',
      detail: 'npm install: Necesita una dependencia.',
    });
  });

  it('answers through the activity:list channel of the core', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-activity-'));
    roots.push(root);
    const core = createWorkspaceCore(join(root, 'workspace'));
    try {
      const project = (await core.handle({
        channel: 'project:create',
        args: [{ name: 'Actividad', slug: 'actividad' }],
      })) as { id: string };
      expect(await core.handle({ channel: 'activity:list', args: [project.id] })).toEqual({
        items: [],
        running: [],
        attentionCount: 0,
      });
    } finally {
      core.close();
    }
  });
});
