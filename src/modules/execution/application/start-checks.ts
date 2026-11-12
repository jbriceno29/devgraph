import type { AgentExecution } from '../domain/models.js';
import type { FeaturePlan } from './prompts/task-prompt.js';
import type { ExecutionKernel } from './execution-kernel.js';

/**
 * A group may start when its leader is READY and every other task is READY, or BLOCKED only by tasks of the group;
 * all in the leader's feature, none with an open dependency outside the group.
 */
export function checkGroupCanStart(
  k: ExecutionKernel,
  projectId: string,
  leader: { id: string; displayKey: string; status: string },
  group: Array<{ id: string; displayKey: string; status: string }>,
): void {
  if (leader.status !== 'READY')
    throw new Error(`La tarea ${leader.displayKey} debe estar en estado READY para iniciar.`);
  const ids = new Set(group.map(task => task.id));
  const feature = group.length > 1 ? k.repository.findFeatureFor(projectId, leader.id) : null;
  for (const task of group) {
    if (task.id !== leader.id && task.status !== 'READY' && task.status !== 'BLOCKED')
      throw new Error(
        `La tarea ${task.displayKey} debe estar lista o bloqueada solo por tareas del grupo para ejecutarse en grupo (está en ${task.status}).`,
      );
    if (group.length > 1 && k.repository.findFeatureFor(projectId, task.id)?.id !== feature?.id)
      throw new Error(
        `La tarea ${task.displayKey} no es de la misma feature que ${leader.displayKey}: un grupo solo junta tareas de una feature.`,
      );
    const pending = k.repository
      .listDependencies(projectId, task.id)
      .filter(dependency => dependency.status !== 'DONE' && !ids.has(dependency.id));
    if (pending.length)
      throw new Error(
        `La tarea ${task.displayKey} depende de tareas sin terminar: ${pending.map(dependency => `${dependency.displayKey} (${dependency.status})`).join(', ')}.`,
      );
  }
}

/** The feature around a task as the prompt shows it: its tasks with status and direct dependencies. Only when proposals are wired. */
export function featurePlan(k: ExecutionKernel, projectId: string, workItemIds: string[]): FeaturePlan | undefined {
  if (!k.planProposals) return undefined;
  try {
    const feature = k.repository.findFeatureFor(projectId, workItemIds[0]!);
    if (!feature) return undefined;
    const tasks = k.repository.listFeatureTasks(projectId, feature.id).map(task => ({
      ...task,
      dependsOn: k.repository.listDependencies(projectId, task.id).map(dependency => dependency.displayKey),
    }));
    return { feature, tasks, currentIds: workItemIds };
  } catch {
    return undefined;
  }
}

/**
 * The engine session of the latest accepted run in the same feature, with the same provider — reused as a cache so a
 * new task does not pay the engine's start-up again. Opt-in with `sessionReuse: 'feature'` in the provider config:
 * measured on 2026-11-11 it cut uncached input by 13 % but doubled cache reads, a worse cost-weighted trade, so it is off
 * by default.
 * Never crosses features or engines: the workspace, not the session, carries context between them.
 */
export function sessionToResume(
  k: ExecutionKernel,
  projectId: string,
  workItemId: string,
  profile: { provider: { id: string }; connectionConfig?: Record<string, unknown> },
  revisionOf: AgentExecution | null,
): string | undefined {
  if (!k.adapter.getCapabilities().supportsResume || profile.connectionConfig?.sessionReuse !== 'feature')
    return undefined;
  const feature = k.repository.findFeatureFor(projectId, workItemId);
  const sameFeature = (execution: AgentExecution) =>
    execution.workItemId !== null &&
    (execution.workItemId === workItemId ||
      (feature !== null && k.repository.findFeatureFor(projectId, execution.workItemId)?.id === feature.id));
  const candidate =
    revisionOf ??
    k.repository
      .listExecutions(projectId)
      .filter(
        execution =>
          execution.providerId === profile.provider.id &&
          execution.status === 'COMPLETED' &&
          execution.reviewStatus === 'ACCEPTED' &&
          execution.sessionId &&
          sameFeature(execution),
      )
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  if (!candidate?.sessionId) return undefined;
  return k.repository.externalSessionId(candidate.sessionId) ?? undefined;
}
