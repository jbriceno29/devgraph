import { type WorkItemStatus, manualWorkItemTransitions } from '../../knowledge/index.js';
import { type ExecutionKernel, terminalStatuses } from './execution-kernel.js';

/** Everything needed to review a run: diff per file, denied actions and what the reviewer can do next. */
export function detail(k: ExecutionKernel, executionId: string) {
  const execution = k.repository.findExecution(executionId);
  if (!execution) throw new Error('Ejecución no encontrada.');
  const task = execution.workItemId ? k.repository.findWorkItem(execution.projectId, execution.workItemId) : null;
  const deniedActions = k.repository
    .listEvents(executionId)
    .flatMap(record =>
      record.event.type === 'ACTION_DENIED'
        ? [{ toolName: record.event.toolName, target: record.event.target, reason: record.event.reason }]
        : [],
    );
  const reviewable =
    execution.status === 'COMPLETED' &&
    task?.status === 'IN_REVIEW' &&
    (!execution.reviewStatus || execution.reviewStatus === 'MERGE_CONFLICT');
  return {
    execution,
    taskStatus: task?.status ?? null,
    files: k.repository.listFileDiffs(executionId).map(diff => ({
      path: diff.filePath,
      changeType: diff.changeType,
      additions: diff.additions,
      deletions: diff.deletions,
      patch: diff.diffPatch,
    })),
    deniedActions,
    canAccept: reviewable,
    canRequestChanges: reviewable && !k.active.has(executionId),
  };
}

/** Manual status change from the inspector. Execution-owned statuses are refused; READY requires its dependencies DONE. */
export function setWorkItemStatus(
  k: ExecutionKernel,
  projectId: string,
  workItemId: string,
  to: WorkItemStatus,
): { status: WorkItemStatus; revision: number } {
  const task = k.repository.findWorkItem(projectId, workItemId);
  if (!task) throw new Error('La tarea no existe en este proyecto.');
  const from = task.status as WorkItemStatus;
  if (!manualWorkItemTransitions(from).includes(to))
    throw new Error(
      from === 'IN_PROGRESS'
        ? `La tarea ${task.displayKey} tiene una ejecución en curso; cancélala antes de cambiar su estado.`
        : `No se puede pasar ${task.displayKey} de ${from} a ${to} a mano.`,
    );
  if (
    k.repository
      .listExecutions(projectId)
      .some(item => item.workItemId === workItemId && !terminalStatuses.has(item.status))
  )
    throw new Error(`La tarea ${task.displayKey} tiene una ejecución en curso.`);
  if (to === 'READY') {
    const pending = k.repository
      .listDependencies(projectId, workItemId)
      .filter(dependency => dependency.status !== 'DONE');
    if (pending.length)
      throw new Error(
        `${task.displayKey} depende de tareas sin terminar: ${pending.map(dependency => `${dependency.displayKey} (${dependency.status})`).join(', ')}. Márcala como BLOCKED; pasará sola a READY cuando terminen.`,
      );
  }
  const revision = k.repository.transitionWorkItem(projectId, workItemId, to);
  k.emit('graph:revision_updated', { projectId, revision });
  return { status: to, revision };
}
