import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../sqlite/database.js';
import type { FeatureTaskView, PilotRepositoryPort } from '../../../application/ports/pilot-port.js';
import { DEFAULT_AUTONOMY, type FeatureAutonomy, type PilotEvent, type PilotEventKind, type PilotRun, type PilotStatus } from '../../../domain/autonomy/models.js';

export class SqlitePilotRepository implements PilotRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}

  getAutonomy(projectId: string, featureId: string): FeatureAutonomy {
    const row = this.db.prepare('SELECT * FROM feature_autonomy WHERE feature_id=?').get(featureId) as AutonomyRow | undefined;
    if (!row) return { featureId, projectId, ...DEFAULT_AUTONOMY };
    return { featureId, projectId: row.project_id, level: row.level, executionModel: row.execution_model, escalationModel: row.escalation_model, maxAttempts: row.max_attempts, usagePauseThreshold: row.usage_pause_threshold };
  }

  saveAutonomy(autonomy: FeatureAutonomy): void {
    this.db.prepare(`INSERT INTO feature_autonomy(feature_id,project_id,level,execution_model,escalation_model,max_attempts,usage_pause_threshold,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(feature_id) DO UPDATE SET level=excluded.level,execution_model=excluded.execution_model,escalation_model=excluded.escalation_model,max_attempts=excluded.max_attempts,usage_pause_threshold=excluded.usage_pause_threshold,updated_at=excluded.updated_at`)
      .run(autonomy.featureId, autonomy.projectId, autonomy.level, autonomy.executionModel, autonomy.escalationModel, autonomy.maxAttempts, autonomy.usagePauseThreshold, new Date().toISOString());
  }

  featureOf(projectId: string, workItemId: string): string | null {
    const lookup = this.db.prepare('SELECT id,entity_type,parent_id FROM knowledge_entities WHERE project_id=? AND id=?');
    let current = lookup.get(projectId, workItemId) as { id: string; entity_type: string; parent_id: string | null } | undefined;
    for (let depth = 0; current && depth < 16; depth += 1) {
      if (current.entity_type === 'FEATURE') return current.id;
      current = current.parent_id ? lookup.get(projectId, current.parent_id) as typeof current : undefined;
    }
    return null;
  }

  listFeatureTasks(projectId: string, featureId: string): FeatureTaskView[] {
    const rows = this.db.prepare(`SELECT e.id,e.display_key,e.title,e.status FROM knowledge_entities e
      WHERE e.project_id=? AND e.entity_type='WORK_ITEM' AND (e.parent_id=? OR e.parent_id IN (SELECT id FROM knowledge_entities WHERE parent_id=? AND entity_type='WORK_ITEM'))
      ORDER BY e.display_key`).all(projectId, featureId, featureId) as Array<{ id: string; display_key: string; title: string; status: string }>;
    const dependencies = this.db.prepare(`SELECT target_id FROM graph_edges WHERE project_id=? AND source_id=? AND edge_type='DEPENDS_ON'`);
    return rows.map(row => ({ id: row.id, displayKey: row.display_key, title: row.title, status: row.status, dependsOn: (dependencies.all(projectId, row.id) as Array<{ target_id: string }>).map(edge => edge.target_id) }));
  }

  createRun(run: PilotRun): void {
    this.db.prepare('INSERT INTO pilot_runs(id,project_id,feature_id,status,reason,started_at,ended_at) VALUES(?,?,?,?,?,?,?)').run(run.id, run.projectId, run.featureId, run.status, run.reason, run.startedAt, run.endedAt);
  }

  updateRun(runId: string, status: PilotStatus, reason: string | null, endedAt: string | null): void {
    this.db.prepare('UPDATE pilot_runs SET status=?,reason=?,ended_at=? WHERE id=?').run(status, reason, endedAt, runId);
  }

  findRun(runId: string): PilotRun | null {
    const row = this.db.prepare('SELECT * FROM pilot_runs WHERE id=?').get(runId) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  latestRun(featureId: string): PilotRun | null {
    const row = this.db.prepare('SELECT * FROM pilot_runs WHERE feature_id=? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(featureId) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(projectId: string, statuses: PilotStatus[]): PilotRun[] {
    if (!statuses.length) return [];
    return (this.db.prepare(`SELECT * FROM pilot_runs WHERE project_id=? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY started_at`).all(projectId, ...statuses) as RunRow[]).map(mapRun);
  }

  appendEvent(runId: string, kind: PilotEventKind, message: string, workItemId: string | null, executionId: string | null): PilotEvent {
    const sequenceNo = (this.db.prepare('SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM pilot_events WHERE pilot_run_id=?').get(runId) as { next: number }).next;
    const event: PilotEvent = { id: randomUUID(), pilotRunId: runId, sequenceNo, kind, message, workItemId, executionId, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO pilot_events(id,pilot_run_id,sequence_no,kind,message,work_item_id,execution_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(event.id, runId, sequenceNo, kind, message, workItemId, executionId, event.createdAt);
    return event;
  }

  listEvents(runId: string, limit: number): PilotEvent[] {
    return (this.db.prepare('SELECT * FROM pilot_events WHERE pilot_run_id=? ORDER BY sequence_no DESC LIMIT ?').all(runId, limit) as EventRow[])
      .map(row => ({ id: row.id, pilotRunId: row.pilot_run_id, sequenceNo: row.sequence_no, kind: row.kind, message: row.message, workItemId: row.work_item_id, executionId: row.execution_id, createdAt: row.created_at })).reverse();
  }
}

interface AutonomyRow { project_id: string; level: FeatureAutonomy['level']; execution_model: string | null; escalation_model: string | null; max_attempts: number; usage_pause_threshold: number }
interface RunRow { id: string; project_id: string; feature_id: string; status: PilotStatus; reason: string | null; started_at: string; ended_at: string | null }
interface EventRow { id: string; pilot_run_id: string; sequence_no: number; kind: PilotEventKind; message: string; work_item_id: string | null; execution_id: string | null; created_at: string }
function mapRun(row: RunRow): PilotRun { return { id: row.id, projectId: row.project_id, featureId: row.feature_id, status: row.status, reason: row.reason, startedAt: row.started_at, endedAt: row.ended_at }; }
