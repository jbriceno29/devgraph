import type { PlanProposalPort } from '../../planning/index.js';
import type { GovernanceInterceptor } from './governance-interceptor.js';
import type { AgentAdapterPort } from './ports/agent-adapter-port.js';
import type {
  AgentContextBuilderPort,
  AgentExecutionRepositoryPort,
  ExecutionEventLogPort,
  ExecutionEventSink,
  ExecutionValidatorPort,
  GitIsolationPort,
  SkillProvisionPort,
  WorkspaceEnvironmentPort,
} from './ports/agent-execution-port.js';
import type { WorkItemStatus } from '../../knowledge/index.js';
import { type AgentEvent, type AgentExecution, type ExecutionStatus, coveredWorkItems } from '../domain/models.js';

/**
 * What every part of the execution flow shares: the ports the orchestrator was built with and the state of the runs
 * this process supervises. Built once by `AgentOrchestrator`; the use cases receive it as their first argument.
 */
export interface ExecutionKernel {
  readonly repository: AgentExecutionRepositoryPort;
  readonly contextBuilder: AgentContextBuilderPort;
  readonly eventLog: ExecutionEventLogPort;
  readonly adapter: AgentAdapterPort;
  readonly isolation: GitIsolationPort;
  readonly validator: ExecutionValidatorPort;
  readonly workspaceRoot: string;
  readonly emit: ExecutionEventSink;
  readonly planProposals: PlanProposalPort | null;
  readonly environment: WorkspaceEnvironmentPort | null;
  readonly skills: SkillProvisionPort | null;
  /** Runs whose engine this process consumes. */
  readonly active: Set<string>;
  /** Runs (and `feature:<id>` integrations) being merged right now. */
  readonly accepting: Set<string>;
  readonly deadlines: Map<string, ReturnType<typeof setTimeout>>;
  readonly finishedListeners: Array<(execution: AgentExecution) => void>;
  readonly governance: GovernanceInterceptor;
}

export const closedStatuses = new Set(['DONE', 'ARCHIVED']);
export const terminalStatuses = new Set<ExecutionStatus>(['COMPLETED', 'FAILED', 'CANCELLED']);

export function notifyFinished(k: ExecutionKernel, execution: AgentExecution): void {
  for (const listener of k.finishedListeners) {
    try {
      listener(execution);
    } catch {
      /* never break the run */
    }
  }
}

export async function persistAndEmit(k: ExecutionKernel, execution: AgentExecution, event: AgentEvent): Promise<void> {
  const record = { ...k.repository.appendEvent(execution.id, event), event };
  await k.eventLog.append(execution.projectId, execution.id, record);
  k.emit('execution:event_received', { executionId: execution.id, event });
}

export function publishStatus(k: ExecutionKernel, execution: AgentExecution): void {
  k.emit('execution:status_changed', {
    executionId: execution.id,
    workItemId: execution.workItemId ?? '',
    status: execution.status,
  });
}

/**
 * Keeps the WorkItem in step with its execution, only from the expected state: a status the user changed
 * meanwhile is never overwritten. Best effort: a failure here must not break the execution flow.
 */
export function moveTask(
  k: ExecutionKernel,
  execution: AgentExecution,
  from: WorkItemStatus,
  to: WorkItemStatus,
): void {
  const grouped = (execution.coveredWorkItemIds?.length ?? 0) > 1;
  for (const workItemId of coveredWorkItems(execution)) {
    try {
      const task = k.repository.findWorkItem(execution.projectId, workItemId);
      if (!task) continue;
      let status = task.status;
      // A group member BLOCKED only by tasks of its group is released when the group starts.
      if (grouped && from === 'READY' && status === 'BLOCKED') {
        k.repository.transitionWorkItem(execution.projectId, workItemId, 'READY');
        status = 'READY';
      }
      if (status !== from) continue;
      // Back to READY only with every dependency DONE; a member whose prerequisite failed with it waits again.
      const target: WorkItemStatus =
        to === 'READY' &&
        grouped &&
        k.repository.listDependencies(execution.projectId, workItemId).some(dependency => dependency.status !== 'DONE')
          ? 'BLOCKED'
          : to;
      const revision = k.repository.transitionWorkItem(execution.projectId, workItemId, target);
      k.emit('graph:revision_updated', { projectId: execution.projectId, revision });
    } catch {
      /* the execution outcome is still recorded */
    }
  }
}

/** A BLOCKED task becomes READY once every task it depends on is DONE. */
export function unblockDependents(k: ExecutionKernel, projectId: string, workItemId: string): void {
  for (const dependent of k.repository.listDependents(projectId, workItemId)) {
    if (dependent.status !== 'BLOCKED') continue;
    if (k.repository.listDependencies(projectId, dependent.id).some(dependency => dependency.status !== 'DONE'))
      continue;
    try {
      const revision = k.repository.transitionWorkItem(projectId, dependent.id, 'READY');
      k.emit('graph:revision_updated', { projectId, revision });
    } catch {
      /* left as is */
    }
  }
}

export async function discardIsolation(
  k: ExecutionKernel,
  execution: AgentExecution,
  repositoryRoot: string,
  isolated: { workingDirectory: string; branchName: string },
): Promise<AgentExecution> {
  try {
    await k.isolation.discard({
      repositoryRoot,
      workspaceRoot: k.workspaceRoot,
      workingDirectory: isolated.workingDirectory,
      branchName: isolated.branchName,
    });
  } catch {
    return execution;
  }
  if (execution.branchOrWorktree === null) return execution;
  const latest = k.repository.findExecution(execution.id) ?? execution;
  const cleaned = { ...latest, branchOrWorktree: null };
  k.repository.updateExecution(cleaned);
  return cleaned;
}

/**
 * `TASK-001: título` for one task; for a group, `TASK-004, TASK-005: título · título` with a `Task:` trailer per task,
 * so the commit on the feature branch still says which tasks it closed. Null when the run has no task.
 */
export function commitMessage(k: ExecutionKernel, execution: AgentExecution): string | null {
  const tasks = coveredWorkItems(execution).flatMap(id => {
    const task = k.repository.findWorkItem(execution.projectId, id);
    return task ? [task] : [];
  });
  if (!tasks.length) return null;
  if (tasks.length === 1)
    return `${tasks[0]!.displayKey}: ${tasks[0]!.title}\n\nGraph Workspace execution ${execution.id}`;
  const titles = tasks.map(task => task.title).join(' · ');
  const subject = `${tasks.map(task => task.displayKey).join(', ')}: ${titles.length > 80 ? `${titles.slice(0, 79).trimEnd()}…` : titles}`;
  return `${subject}\n\nGraph Workspace execution ${execution.id}\n\n${tasks.map(task => `Task: ${task.displayKey} ${task.title}`).join('\n')}`;
}

/** The agent's closing summary (with its proposal block, if any). */
export function closingSummary(k: ExecutionKernel, execution: AgentExecution): string {
  try {
    const finished = [...k.repository.listEvents(execution.id)]
      .reverse()
      .find(record => record.event.type === 'EXECUTION_FINISHED')?.event;
    return (finished?.type === 'EXECUTION_FINISHED' ? finished.summary : '') || execution.resultSummary || '';
  } catch {
    return execution.resultSummary ?? '';
  }
}
