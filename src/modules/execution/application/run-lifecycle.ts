import { type AgentEvent, type AgentExecution, transitionExecution } from '../domain/models.js';
import {
  type ExecutionKernel,
  commitMessage,
  moveTask,
  notifyFinished,
  persistAndEmit,
  publishStatus,
  terminalStatuses,
} from './execution-kernel.js';

/** Follows the engine's stream of a run until it ends, validates its work and leaves the run and its task settled. */
export async function consume(
  k: ExecutionKernel,
  execution: AgentExecution,
  events: AsyncIterable<AgentEvent>,
): Promise<void> {
  try {
    const terminal = await followStream(k, execution, events);
    await validateRun(k, execution, terminal);
  } catch (error) {
    await failConsumer(k, execution, error);
  } finally {
    k.active.delete(execution.id);
    k.governance.cancel(execution.id);
    const deadline = k.deadlines.get(execution.id);
    if (deadline) {
      clearTimeout(deadline);
      k.deadlines.delete(execution.id);
    }
  }
}

/** Records every event (approvals go through governance) and returns the one that ended the run, if any. */
async function followStream(
  k: ExecutionKernel,
  execution: AgentExecution,
  events: AsyncIterable<AgentEvent>,
): Promise<AgentEvent | undefined> {
  let terminal: AgentEvent | undefined;
  for await (const event of events) {
    if (event.type === 'APPROVAL_REQUIRED') {
      if (!(await k.governance.intercept(execution, event)))
        throw new Error('La acción solicitada fue rechazada por el usuario.');
    } else await persistAndEmit(k, execution, event);
    // The CLI reports the concrete model behind an alias (e.g. sonnet -> claude-sonnet-...).
    if (event.type === 'SESSION_INITIALIZED' && event.model) {
      const latest = k.repository.findExecution(execution.id);
      if (latest && !terminalStatuses.has(latest.status) && latest.modelUsed !== event.model)
        k.repository.updateExecution({ ...latest, modelUsed: event.model });
    }
    if (event.type === 'EXECUTION_FINISHED' || event.type === 'EXECUTION_FAILED') terminal = event;
  }
  return terminal;
}

/** VALIDATING: audits the diff and runs the checks; COMPLETED leaves the task in review, FAILED makes it available. */
async function validateRun(k: ExecutionKernel, execution: AgentExecution, terminal: AgentEvent | undefined) {
  const current = k.repository.findExecution(execution.id);
  if (!current || terminalStatuses.has(current.status)) return;
  const validating = transitionExecution(current, 'VALIDATING');
  k.repository.updateExecution(validating);
  publishStatus(k, validating);
  const repositoryId = k.repository.getRepositoryId(execution.projectId);
  if (!repositoryId) throw new Error('No se encontró el repositorio para auditar el diff.');
  const message = commitMessage(k, execution);
  const environment = k.environment?.forProject(execution.projectId) ?? null;
  const result = await k.validator.validate({
    projectId: execution.projectId,
    executionId: execution.id,
    workingDirectory: execution.branchOrWorktree!,
    repositoryRoot: k.repository.getRepositoryRoot(execution.projectId)!,
    repositoryId,
    initialCommit: execution.initialCommit,
    policy: k.repository.getAutonomyPolicy(execution.projectId, execution.profileId),
    ...(message ? { commitMessage: message } : {}),
    ...(environment ? { environment } : {}),
    ...(k.skills ? { ownedPaths: await k.skills.ownedPaths() } : {}),
  });
  // The user may have cancelled while validation ran; never overwrite a terminal status.
  const latest = k.repository.findExecution(execution.id);
  if (!latest || latest.status !== 'VALIDATING') return;
  const failure = terminal?.type === 'EXECUTION_FAILED' ? terminal : null;
  const finalStatus = result.passed && !failure ? 'COMPLETED' : 'FAILED';
  const updated = {
    ...transitionExecution(latest, finalStatus),
    finalCommit: result.finalCommit,
    testSummary: result.testSummary,
    resultSummary: failure ? failure.errorMessage : result.resultSummary,
    completedAt: new Date().toISOString(),
  };
  k.repository.updateExecution(updated);
  publishStatus(k, updated);
  // COMPLETED leaves the task waiting for review; a failed run makes it available again.
  moveTask(k, updated, 'IN_PROGRESS', finalStatus === 'COMPLETED' ? 'IN_REVIEW' : 'READY');
  notifyFinished(k, updated);
}

/**
 * consume() runs detached; a throw would be an unhandled rejection that kills the sidecar. If the record cannot be
 * updated (e.g. the database closed on shutdown), reconcileInterrupted() fixes it on the next open.
 */
async function failConsumer(k: ExecutionKernel, execution: AgentExecution, error: unknown): Promise<void> {
  try {
    const current = k.repository.findExecution(execution.id);
    if (current && !terminalStatuses.has(current.status)) {
      const result = {
        ...transitionExecution(current, 'FAILED'),
        resultSummary: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
      k.repository.updateExecution(result);
      publishStatus(k, result);
      moveTask(k, result, 'IN_PROGRESS', 'READY');
      notifyFinished(k, result);
    }
  } catch {
    /* left non-terminal on purpose; see above */
  }
  // D7: whatever broke the consumer, the engine must not keep running unsupervised.
  await k.adapter.cancel(execution.id).catch(() => undefined);
}

export async function expire(k: ExecutionKernel, executionId: string, minutes: number): Promise<void> {
  k.deadlines.delete(executionId);
  const execution = k.repository.findExecution(executionId);
  if (!execution || !k.active.has(executionId) || terminalStatuses.has(execution.status)) return;
  const errorMessage = `La ejecución superó el tiempo máximo de ${minutes} min y se detuvo.`;
  await persistAndEmit(k, execution, {
    type: 'EXECUTION_FAILED',
    timestamp: new Date().toISOString(),
    errorCode: 'EXECUTION_TIMEOUT',
    errorMessage,
    isRecoverable: true,
  }).catch(() => undefined);
  const failed = {
    ...transitionExecution(execution, 'FAILED'),
    resultSummary: errorMessage,
    completedAt: new Date().toISOString(),
  };
  k.repository.updateExecution(failed);
  publishStatus(k, failed);
  moveTask(k, failed, 'IN_PROGRESS', 'READY');
  notifyFinished(k, failed);
  k.governance.cancel(executionId);
  await k.adapter.cancel(executionId).catch(() => undefined);
}

export async function cancel(k: ExecutionKernel, executionId: string): Promise<AgentExecution> {
  const execution = k.repository.findExecution(executionId);
  if (!execution) throw new Error('Ejecución no encontrada.');
  if (terminalStatuses.has(execution.status)) throw new Error('La ejecución ya terminó.');
  const orphan = !k.active.has(executionId);
  // Persist CANCELLED before waking the consumer or stopping the engine, so no later write can overwrite it.
  const updated = transitionExecution(execution, 'CANCELLED');
  let result = {
    ...updated,
    completedAt: new Date().toISOString(),
    resultSummary: orphan ? 'Ejecución interrumpida cancelada por el usuario.' : 'Ejecución cancelada por el usuario.',
  };
  k.repository.updateExecution(result);
  publishStatus(k, result);
  moveTask(k, result, 'IN_PROGRESS', 'READY');
  notifyFinished(k, result);
  if (orphan) return result;
  k.governance.cancel(executionId);
  try {
    await k.adapter.cancel(executionId);
  } catch (error) {
    result = {
      ...result,
      resultSummary: `${result.resultSummary} No se pudo detener el proceso del motor: ${error instanceof Error ? error.message : String(error)}`,
    };
    k.repository.updateExecution(result);
  }
  return result;
}

/** Fails every non-terminal execution this process is not running: it was interrupted by a crash or restart. */
export function reconcileInterrupted(k: ExecutionKernel, projectId: string): AgentExecution[] {
  const interrupted: AgentExecution[] = [];
  for (const execution of k.repository.listExecutions(projectId)) {
    if (terminalStatuses.has(execution.status) || k.active.has(execution.id)) continue;
    const errorMessage =
      'Ejecución interrumpida: la aplicación se cerró antes de que terminara. El worktree se conserva para revisión.';
    const event: AgentEvent = {
      type: 'EXECUTION_FAILED',
      timestamp: new Date().toISOString(),
      errorCode: 'EXECUTION_INTERRUPTED',
      errorMessage,
      isRecoverable: true,
    };
    k.repository.appendEvent(execution.id, event);
    k.emit('execution:event_received', { executionId: execution.id, event });
    const failed = {
      ...transitionExecution(execution, 'FAILED'),
      resultSummary: errorMessage,
      completedAt: new Date().toISOString(),
    };
    k.repository.updateExecution(failed);
    publishStatus(k, failed);
    moveTask(k, failed, 'IN_PROGRESS', 'READY');
    try {
      k.repository.rejectPendingApprovals(execution.id, 'Ejecución interrumpida antes de resolver la aprobación.');
    } catch {
      /* nothing pending */
    }
    interrupted.push(failed);
  }
  return interrupted;
}

/** Stops every engine this process runs (app shutdown). The records are reconciled as interrupted on the next open. */
export function shutdown(k: ExecutionKernel): void {
  for (const executionId of k.active) {
    k.governance.cancel(executionId);
    void k.adapter.cancel(executionId).catch(() => undefined);
  }
  for (const deadline of k.deadlines.values()) clearTimeout(deadline);
  k.deadlines.clear();
}
