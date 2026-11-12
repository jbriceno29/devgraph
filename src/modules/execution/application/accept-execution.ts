import { stripProposalBlock } from '../../autopilot/index.js';
import { type AgentExecution, coveredWorkItems } from '../domain/models.js';
import { splitSummaryByTask } from '../domain/task-outcome.js';
import { type PlanProposalOutcome, handleProposal } from './agent-proposal.js';
import {
  type ExecutionKernel,
  closingSummary,
  commitMessage,
  moveTask,
  publishStatus,
  unblockDependents,
} from './execution-kernel.js';

type AcceptResult = {
  execution: AgentExecution;
  merged: boolean;
  conflict: { reason: string; detail: string; files: string[] } | null;
  proposal?: PlanProposalOutcome | null;
};

/**
 * Squash-merges a completed run into its integration branch, marks the task DONE and unblocks its dependents.
 * A merge conflict (or the branch being checked out) leaves the task IN_REVIEW and records why.
 */
export async function accept(
  k: ExecutionKernel,
  executionId: string,
  options: { note?: string } = {},
): Promise<AcceptResult> {
  if (k.accepting.has(executionId)) throw new Error('Esta ejecución ya se está integrando.');
  const { execution, repositoryRoot, baseBranch } = acceptable(k, executionId);
  k.accepting.add(executionId);
  try {
    const result = await k.isolation.squashMerge({
      repositoryRoot,
      workspaceRoot: k.workspaceRoot,
      projectId: execution.projectId,
      targetBranch: baseBranch,
      sourceRef: execution.finalCommit ?? execution.initialCommit,
      message: commitMessage(k, execution)!,
    });
    const reviewedAt = new Date().toISOString();
    if (!result.ok) return recordConflict(k, execution, result, reviewedAt);
    // New work on the feature branch: it is no longer integrated in its base branch.
    if (result.changed) k.repository.setFeatureIntegrated?.(execution.projectId, baseBranch, null);
    let accepted: AgentExecution = {
      ...execution,
      reviewStatus: 'ACCEPTED',
      reviewNote: options.note ?? null,
      mergedCommit: result.commit,
      reviewedAt,
    };
    k.repository.updateExecution(accepted);
    accepted = await dropWorktree(k, accepted, repositoryRoot);
    const summary = closingSummary(k, accepted);
    await recordOutcomes(
      k,
      accepted,
      repositoryRoot,
      result.changed ? result.commit : null,
      stripProposalBlock(summary) || 'Sin resumen del agente.',
    );
    moveTask(k, accepted, 'IN_REVIEW', 'DONE');
    for (const id of coveredWorkItems(accepted)) unblockDependents(k, execution.projectId, id);
    // After DONE, so a new task that depends on this one starts READY.
    const proposal = await handleProposal(k, accepted, summary);
    publishStatus(k, accepted);
    return { execution: accepted, merged: true, conflict: null, proposal };
  } finally {
    k.accepting.delete(executionId);
  }
}

/** A run that can be accepted now: COMPLETED, not reviewed yet (or after a conflict), its tasks in review. */
function acceptable(k: ExecutionKernel, executionId: string) {
  const execution = k.repository.findExecution(executionId);
  if (!execution?.workItemId) throw new Error('Ejecución no encontrada.');
  if (execution.status !== 'COMPLETED') throw new Error('Solo se puede aceptar una ejecución completada.');
  if (execution.reviewStatus && execution.reviewStatus !== 'MERGE_CONFLICT')
    throw new Error('Esta ejecución ya fue revisada.');
  if (!execution.baseBranch) throw new Error('La ejecución no tiene rama de integración.');
  const tasks = coveredWorkItems(execution).map(id => k.repository.findWorkItem(execution.projectId, id));
  if (tasks.some(task => !task || task.status !== 'IN_REVIEW'))
    throw new Error('La tarea debe estar en revisión para aceptar la ejecución.');
  const repositoryRoot = k.repository.getRepositoryRoot(execution.projectId);
  if (!repositoryRoot) throw new Error('Configura primero un repositorio Git para este proyecto.');
  return { execution, repositoryRoot, baseBranch: execution.baseBranch };
}

function recordConflict(
  k: ExecutionKernel,
  execution: AgentExecution,
  result: { reason: string; detail: string; conflicts: string[] },
  reviewedAt: string,
): AcceptResult {
  const conflicted = {
    ...execution,
    reviewStatus: 'MERGE_CONFLICT' as const,
    reviewNote: [result.detail, ...result.conflicts].join('\n'),
    reviewedAt,
  };
  k.repository.updateExecution(conflicted);
  publishStatus(k, conflicted);
  return {
    execution: conflicted,
    merged: false,
    conflict: { reason: result.reason, detail: result.detail, files: result.conflicts },
    proposal: null,
  };
}

/** The accepted run's worktree and branch are no longer needed: its work is in the feature branch. */
async function dropWorktree(k: ExecutionKernel, accepted: AgentExecution, repositoryRoot: string) {
  if (!accepted.branchOrWorktree || !accepted.executionBranch) return accepted;
  return k.isolation
    .discard({
      repositoryRoot,
      workspaceRoot: k.workspaceRoot,
      workingDirectory: accepted.branchOrWorktree,
      branchName: accepted.executionBranch,
    })
    .then(
      () => {
        const cleaned = { ...accepted, branchOrWorktree: null };
        k.repository.updateExecution(cleaned);
        return cleaned;
      },
      () => accepted,
    );
}

/**
 * Leaves the task's memory in the graph (Stage 2): the agent's closing summary, the files of the integrated commit
 * and the checks that passed. Best effort: the merge already happened and must not be reported as failed.
 */
export async function recordOutcomes(
  k: ExecutionKernel,
  execution: AgentExecution,
  repositoryRoot: string,
  mergedCommit: string | null,
  summary: string,
): Promise<void> {
  const ids = coveredWorkItems(execution);
  if (!ids.length) return;
  try {
    const repositoryId = k.repository.getRepositoryId(execution.projectId);
    if (!repositoryId) return;
    const files = mergedCommit ? await k.isolation.commitFiles(repositoryRoot, mergedCommit) : [];
    const commands =
      (execution.testSummary as { commands?: Array<{ command: string; exitCode: number }> } | null)?.commands ?? [];
    const checks = commands.map(item => ({ command: item.command, passed: item.exitCode === 0 }));
    // A grouped run leaves one summary per task (its section); when the agent did not separate them, every task keeps the whole summary, flagged.
    const tasks = ids.map(id => ({
      id,
      key: k.repository.findWorkItem(execution.projectId, id)?.displayKey ?? id,
    }));
    const sections =
      ids.length > 1
        ? splitSummaryByTask(
            summary,
            tasks.map(task => task.key),
          )
        : null;
    const shared =
      ids.length > 1 && !sections
        ? `(Resumen compartido del grupo ${tasks.map(task => task.key).join(', ')}: el agente no separó los apartados por tarea.)\n\n${summary}`
        : summary;
    let revision = 0;
    for (const task of tasks)
      revision = k.repository.recordTaskOutcome(
        {
          workItemId: task.id,
          projectId: execution.projectId,
          executionId: execution.id,
          summary: (sections?.get(task.key) ?? shared).slice(0, 8_000),
          files,
          checks,
          mergedCommit,
          integrationBranch: execution.baseBranch,
          createdAt: new Date().toISOString(),
        },
        repositoryId,
      );
    k.emit('graph:revision_updated', { projectId: execution.projectId, revision });
  } catch {
    /* the task is still integrated; its memory can be rebuilt from the execution */
  }
}
