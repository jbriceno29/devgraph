import type { ActivityItemDto, ActivitySummaryDto } from '../../shared/contracts/activity-view.js';
import type { InceptionActivityDto } from '../../shared/contracts/inception-view.js';
import type { ActivityExecutionRow, ActivitySourcePort, ActivityTaskRow } from '../ports/activity-port.js';

export const DEFAULT_ACTIVITY_LIMIT = 50;

/**
 * Activity inbox of a project, derived from data that already exists (no AI, no new tables): one entry per task by its
 * current state, plus pilot runs, agent plan proposals and pending approvals. Items that need the user come first.
 */
export class ActivityService {
  constructor(private readonly source: ActivitySourcePort, private readonly inception: (projectId: string) => InceptionActivityDto | null = () => null) {}

  list(projectId: string, limit = DEFAULT_ACTIVITY_LIMIT): ActivitySummaryDto {
    const max = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : DEFAULT_ACTIVITY_LIMIT;
    const data = this.source.snapshot(projectId, max);
    const latest = new Map(data.latestExecutions.filter(execution => execution.workItemId).map(execution => [execution.workItemId!, execution]));
    const activePilot = new Set(data.pilots.filter(pilot => pilot.status === 'RUNNING' || pilot.status === 'PAUSED').map(pilot => pilot.featureId));
    const keyOf = new Map(data.tasks.map(task => [task.id, task.displayKey]));
    const items: ActivityItemDto[] = [];
    const push = (item: Omit<ActivityItemDto, 'workItemId' | 'executionId' | 'featureId' | 'changeSetId'> & Partial<ActivityItemDto>) => items.push({ workItemId: null, executionId: null, featureId: null, changeSetId: null, ...item });

    // One entry per task, by its current state: a DONE task never shows up again as ready or running.
    for (const task of data.tasks) {
      const execution = latest.get(task.id) ?? null, name = `${task.displayKey} ${task.title}`;
      const base = { workItemId: task.id, featureId: task.featureId, executionId: execution?.id ?? null, target: 'agents' as const };
      if (task.status === 'IN_PROGRESS') push({ ...base, id: `TASK_RUNNING:${execution?.id ?? task.id}`, at: execution?.startedAt ?? task.updatedAt, kind: 'TASK_RUNNING', title: `${name} en curso`, detail: 'Un agente está trabajando en esta tarea.', needsAttention: false });
      else if (task.status === 'IN_REVIEW') items.push(review(task, execution, name, base, Boolean(task.featureId && (data.autonomy[task.featureId] === 'AUTO_ACCEPT' || activePilot.has(task.featureId)))));
      else if (task.status === 'DONE') push({ ...base, id: `TASK_DONE:${task.id}`, at: execution?.completedAt && execution.completedAt > task.updatedAt ? execution.completedAt : task.updatedAt, kind: 'TASK_DONE', title: `${name} terminada`, detail: null, needsAttention: false, target: 'graph' });
      else if (task.status === 'READY' && execution?.status === 'FAILED') {
        const retrying = Boolean(task.featureId && activePilot.has(task.featureId));
        push({ ...base, id: `TASK_FAILED:${execution.id}`, at: execution.completedAt ?? task.updatedAt, kind: 'TASK_FAILED', title: `${name} no se pudo completar`, detail: retrying ? 'El piloto volverá a intentarlo.' : firstLine(execution.resultSummary) ?? 'El agente no pudo terminarla. Mira qué pasó y vuelve a lanzarla.', needsAttention: !retrying });
      } else if (task.status === 'READY') push({ ...base, id: `TASK_READY:${task.id}`, at: task.updatedAt, kind: 'TASK_READY', title: `Tarea lista: ${name}`, detail: 'Puedes lanzarla con un agente.', needsAttention: false });
    }

    for (const pilot of data.pilots) {
      const feature = `${pilot.featureKey} ${pilot.featureTitle}`, base = { featureId: pilot.featureId, target: 'agents' as const, detail: pilot.reason };
      if (pilot.status === 'WAITING_USER') push({ ...base, id: `PILOT_WAITING:${pilot.id}:${pilot.reason ?? ''}`, at: pilot.endedAt ?? pilot.startedAt, kind: 'PILOT_WAITING', title: `El piloto de ${feature} espera tu decisión`, needsAttention: true });
      else if (pilot.status === 'PAUSED') push({ ...base, id: `PILOT_PAUSED:${pilot.id}:${pilot.reason ?? ''}`, at: pilot.endedAt ?? pilot.startedAt, kind: 'PILOT_PAUSED', title: `El piloto de ${feature} está en pausa`, needsAttention: false });
      else if (pilot.status === 'COMPLETED') push({ ...base, id: `PILOT_COMPLETED:${pilot.id}`, at: pilot.endedAt ?? pilot.startedAt, kind: 'PILOT_COMPLETED', title: `El piloto terminó ${feature}`, needsAttention: false });
    }

    for (const proposal of data.pendingProposals) {
      const key = proposal.workItemId ? keyOf.get(proposal.workItemId) ?? null : null;
      push({ id: `PLAN_PROPOSAL:${proposal.id}`, at: proposal.createdAt, kind: 'PLAN_PROPOSAL', title: `Propuesta de cambios al plan: ${proposal.title}`, detail: `${key ? `El agente la propuso al cerrar ${key}. ` : 'La propuso un agente. '}Acéptala o recházala en Planificación.`, needsAttention: true, workItemId: proposal.workItemId, executionId: proposal.executionId, changeSetId: proposal.id, target: 'planning' });
    }
    for (const proposal of data.appliedProposals) {
      const key = proposal.workItemId ? keyOf.get(proposal.workItemId) ?? null : null;
      push({ id: `PLAN_CHANGED:${proposal.id}`, at: proposal.appliedAt ?? proposal.createdAt, kind: 'PLAN_CHANGED', title: `Plan actualizado: ${proposal.title}`, detail: key ? `Cambio propuesto por el agente al cerrar ${key}.` : 'Cambio propuesto por un agente.', needsAttention: false, workItemId: proposal.workItemId, executionId: proposal.executionId, changeSetId: proposal.id, target: 'graph' });
    }
    for (const approval of data.pendingApprovals) {
      const key = approval.workItemId ? keyOf.get(approval.workItemId) ?? null : null;
      push({ id: `APPROVAL_PENDING:${approval.id}`, at: approval.requestedAt, kind: 'APPROVAL_PENDING', title: key ? `Un agente pide permiso en ${key}` : 'Un agente pide permiso', detail: `${approval.requestedAction}: ${approval.reason}`, needsAttention: true, workItemId: approval.workItemId, executionId: approval.executionId, target: 'agents' });
    }

    // Project inception: the proposal waiting for approval is a plan proposal (reviewable in Planning); the questions only live in `inception`.
    const inception = this.inception(projectId);
    if (inception?.stage === 'PROPOSAL' && inception.changeSetId && inception.status === 'WAITING_USER') push({ id: `PLAN_PROPOSAL:${inception.changeSetId}`, at: inception.at, kind: 'PLAN_PROPOSAL', title: inception.title, detail: inception.detail, needsAttention: true, changeSetId: inception.changeSetId, target: 'planning' });

    items.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const running = data.tasks.filter(task => task.status === 'IN_PROGRESS').map(task => ({ workItemKey: task.displayKey, title: task.title }));
    const inceptionItem = items.some(item => item.changeSetId && item.changeSetId === inception?.changeSetId);
    return { items: items.slice(0, max), running, attentionCount: items.filter(item => item.needsAttention).length + (inception?.needsAttention && !inceptionItem ? 1 : 0), ...(inception ? { inception } : {}) };
  }
}

function review(task: ActivityTaskRow, execution: ActivityExecutionRow | null, name: string, base: { workItemId: string; featureId: string | null; executionId: string | null; target: 'agents' }, automatic: boolean): ActivityItemDto {
  const conflict = execution?.reviewStatus === 'MERGE_CONFLICT';
  const pending = execution?.status === 'COMPLETED' && (!execution.reviewStatus || conflict);
  const needsAttention = conflict || (pending && !automatic);
  const detail = conflict ? 'El resultado choca con cambios recientes del proyecto; revísalo para integrarlo.' : needsAttention ? firstLine(execution?.resultSummary ?? null) ?? 'El agente terminó; revisa el resultado y acéptalo o pide cambios.' : 'Se integrará sola si pasa la auditoría y las comprobaciones.';
  return { ...base, changeSetId: null, id: `TASK_IN_REVIEW:${execution?.id ?? task.id}${conflict ? ':conflict' : ''}`, at: execution?.completedAt ?? task.updatedAt, kind: 'TASK_IN_REVIEW', title: conflict ? `Conflicto al integrar ${name}` : `${name} lista para revisar`, detail, needsAttention };
}

/** First readable line of an agent summary, without markdown marks, capped for a list. */
function firstLine(text: string | null): string | null {
  const line = text?.split('\n').map(part => part.replace(/[*#`>_]+/g, '').trim()).find(Boolean);
  return line ? (line.length > 160 ? `${line.slice(0, 157)}…` : line) : null;
}
