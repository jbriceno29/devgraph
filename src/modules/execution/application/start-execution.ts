import { type AgentEvent, type AgentExecution, coveredWorkItems, transitionExecution } from '../domain/models.js';
import {
  type ExecutionKernel,
  discardIsolation,
  moveTask,
  persistAndEmit,
  publishStatus,
  terminalStatuses,
} from './execution-kernel.js';
import { integrationBranchFor, supersede, syncDocuments } from './feature-branches.js';
import { buildTaskPrompt, describeEnvironment, RESUMED_SESSION_NOTE } from './prompts/task-prompt.js';
import { consume, expire, reconcileInterrupted } from './run-lifecycle.js';
import { type PreparedRun, prepareRun } from './prepare-run.js';
import { checkGroupCanStart, featurePlan, sessionToResume } from './start-checks.js';

export interface StartInput {
  projectId: string;
  workItemId: string;
  workItemIds?: string[];
  profileId: string;
  model?: string;
  revisionOf?: string;
  feedback?: string;
  retryContext?: string;
}
type Repository = ExecutionKernel['repository'];
type WorkItem = NonNullable<ReturnType<Repository['findWorkItem']>>;
type Profile = NonNullable<ReturnType<Repository['findProfile']>>;
export type Isolated = { workingDirectory: string; branchName: string; baseCommit: string; baseBranch: string | null };

/** What a run starts with, once every precondition was checked. */
export interface StartPlan {
  input: StartInput;
  workItem: WorkItem;
  previous: AgentExecution | null;
  group: WorkItem[];
  groupIds: string[];
  profile: Profile;
  requestedModel: string | undefined;
  repositoryRoot: string;
  policy: ReturnType<Repository['getAutonomyPolicy']>;
  startPoint: string;
}

/**
 * Starts a run for a READY task, or — with `revisionOf` and `feedback` — a revision of a completed run whose task is IN_REVIEW.
 * With `workItemIds`, one run covers several tasks of the same feature (Etapa 0): `workItemId` leads, the rest may be
 * READY or BLOCKED only by tasks of the group. Every task moves together; a revision keeps the group of the run it adjusts.
 */
export async function start(k: ExecutionKernel, input: StartInput): Promise<AgentExecution> {
  const plan = await planStart(k, input);
  let execution = createExecution(k, plan);
  k.active.add(execution.id);
  let handedToConsumer = false;
  let isolated: Isolated | null = null;
  try {
    isolated = await k.isolation.prepare({
      projectId: input.projectId,
      executionId: execution.id,
      workItemKey: plan.workItem.displayKey,
      repositoryRoot: plan.repositoryRoot,
      workspaceRoot: k.workspaceRoot,
      requireWorktree: plan.policy.requireWorktreeIsolation,
      startPoint: plan.startPoint,
    });
    const prepared = await prepareRun(k, plan, execution, isolated);
    if ('discarded' in prepared) return prepared.discarded;
    execution = await launchRun(k, plan, prepared);
    handedToConsumer = true;
    return execution;
  } catch (error) {
    return failStart(k, execution, plan.repositoryRoot, isolated, error);
  } finally {
    if (!handedToConsumer) k.active.delete(execution.id);
  }
}

/** Re-runs the task of a completed execution, starting from its work, with the reviewer's feedback in the prompt. */
export async function requestChanges(
  k: ExecutionKernel,
  input: { executionId: string; feedback: string; model?: string },
): Promise<AgentExecution> {
  const previous = k.repository.findExecution(input.executionId);
  if (!previous?.workItemId) throw new Error('Ejecución no encontrada.');
  return start(k, {
    projectId: previous.projectId,
    workItemId: previous.workItemId,
    profileId: previous.profileId,
    revisionOf: previous.id,
    feedback: input.feedback,
    ...(input.model ? { model: input.model } : {}),
  });
}

/** The task (or group), the revision it adjusts, the profile and model, and the commit the run starts from. */
async function planStart(k: ExecutionKernel, input: StartInput): Promise<StartPlan> {
  const workItem = k.repository.findWorkItem(input.projectId, input.workItemId);
  if (!workItem) throw new Error('La entidad seleccionada no es una tarea de este proyecto.');
  const previous = input.revisionOf ? k.repository.findExecution(input.revisionOf) : null;
  const groupIds = previous
    ? coveredWorkItems(previous)
    : [workItem.id, ...new Set((input.workItemIds ?? []).filter(id => id !== workItem.id))];
  const group = groupIds.map(id => {
    const task = id === workItem.id ? workItem : k.repository.findWorkItem(input.projectId, id);
    if (!task) throw new Error('Una de las tareas del grupo no pertenece a este proyecto.');
    return task;
  });
  if (input.revisionOf) checkRevision(input, workItem, previous, group);
  else checkGroupCanStart(k, input.projectId, workItem, group);
  const { profile, requestedModel } = developerProfile(k, input);
  const repositoryRoot = k.repository.getRepositoryRoot(input.projectId),
    repositoryId = k.repository.getRepositoryId(input.projectId);
  if (!repositoryRoot || !repositoryId) throw new Error('Configura primero un repositorio Git para este proyecto.');
  const policy = k.repository.getAutonomyPolicy(input.projectId, profile.id);
  if (policy.requireWorktreeIsolation && !k.adapter.getCapabilities().supportsWorktrees)
    throw new Error('La política requiere aislamiento, pero el adaptador no declara soporte para worktrees.');
  reconcileInterrupted(k, input.projectId);
  if (
    k.repository
      .listExecutions(input.projectId)
      .some(item => !terminalStatuses.has(item.status) && coveredWorkItems(item).some(id => groupIds.includes(id)))
  )
    throw new Error('Esta tarea ya tiene una ejecución activa.');
  // A run starts from its feature's integration branch; a revision starts from the commit it adjusts.
  const startPoint = previous
    ? (previous.finalCommit ?? previous.initialCommit)
    : await integrationBranchFor(k, input.projectId, workItem, repositoryRoot, repositoryId);
  if (!previous) await syncDocuments(k, input.projectId, repositoryRoot, startPoint);
  return { input, workItem, previous, group, groupIds, profile, requestedModel, repositoryRoot, policy, startPoint };
}

function checkRevision(input: StartInput, workItem: WorkItem, previous: AgentExecution | null, group: WorkItem[]) {
  if (!previous || previous.workItemId !== workItem.id)
    throw new Error('La ejecución a ajustar no pertenece a esta tarea.');
  if (previous.status !== 'COMPLETED' || (previous.reviewStatus && previous.reviewStatus !== 'MERGE_CONFLICT'))
    throw new Error(
      'Solo se pueden pedir ajustes sobre una ejecución completada que no se haya aceptado ni ajustado ya.',
    );
  for (const task of group)
    if (task.status !== 'IN_REVIEW')
      throw new Error(`La tarea ${task.displayKey} debe estar en revisión para pedir ajustes.`);
  if (!input.feedback?.trim()) throw new Error('Describe los ajustes que necesitas.');
}

function developerProfile(k: ExecutionKernel, input: StartInput) {
  const profile = k.repository.findProfile(input.projectId, input.profileId);
  if (!profile || profile.roleKey !== 'DEVELOPER') throw new Error('Selecciona un perfil DEVELOPER del proyecto.');
  if (profile.provider.providerKey !== k.adapter.providerId)
    throw new Error(`El adaptador ${profile.provider.providerKey} no está disponible.`);
  const availableModels = profile.models?.available ?? [];
  const requestedModel = input.model?.trim() || profile.models?.default || undefined;
  if (input.model?.trim() && !availableModels.includes(input.model.trim()))
    throw new Error(`El modelo ${input.model} no está disponible para ${profile.provider.displayName}.`);
  return { profile, requestedModel };
}

/** The QUEUED record, moved at once to PREPARING_CONTEXT. */
function createExecution(k: ExecutionKernel, plan: StartPlan): AgentExecution {
  let execution: AgentExecution = {
    id: globalThis.crypto.randomUUID(),
    projectId: plan.input.projectId,
    workItemId: plan.workItem.id,
    profileId: plan.profile.id,
    providerId: plan.profile.provider.id,
    sessionId: null,
    contextSnapshotId: null,
    status: 'QUEUED',
    modelUsed: plan.requestedModel ?? null,
    initialCommit: 'PENDING_ISOLATION',
    finalCommit: null,
    branchOrWorktree: null,
    baseBranch: null,
    executionBranch: null,
    revisionOf: plan.previous?.id ?? null,
    testSummary: null,
    resultSummary: null,
    startedAt: null,
    completedAt: null,
    ...(plan.groupIds.length > 1 ? { coveredWorkItemIds: plan.groupIds } : {}),
  };
  k.repository.createExecution(execution);
  publishStatus(k, execution);
  execution = transitionExecution(execution, 'PREPARING_CONTEXT');
  k.repository.updateExecution(execution);
  publishStatus(k, execution);
  return execution;
}

/** RUNNING: the task moves, the revised run is superseded, the engine starts and its stream is consumed detached. */
async function launchRun(k: ExecutionKernel, plan: StartPlan, run: PreparedRun): Promise<AgentExecution> {
  const { input, previous, profile, policy } = plan;
  if (!k.adapter.getCapabilities().supportsStreaming)
    throw new Error('El adaptador seleccionado no soporta eventos en streaming.');
  let execution: AgentExecution = {
    ...run.execution,
    contextSnapshotId: run.context.snapshot.id,
    startedAt: new Date().toISOString(),
  };
  execution = transitionExecution(execution, 'RUNNING');
  k.repository.updateExecution(execution);
  publishStatus(k, execution);
  moveTask(k, execution, previous ? 'IN_REVIEW' : 'READY', 'IN_PROGRESS');
  if (previous) await supersede(k, previous, input.feedback!.trim(), plan.repositoryRoot);
  const prompt = taskPrompt(k, plan, run);
  const resumeSessionId = sessionToResume(k, input.projectId, plan.workItem.id, profile, previous);
  const stream = k.adapter.run({
    executionId: execution.id,
    workingDirectory: run.isolated.workingDirectory,
    prompt: resumeSessionId ? `${prompt}\n\n${RESUMED_SESSION_NOTE}` : prompt,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(run.skillIds.length ? { skills: run.skillIds } : {}),
    ...(plan.requestedModel ? { model: plan.requestedModel } : {}),
    ...(policy.maxTurns > 0 ? { maxTurns: policy.maxTurns } : {}),
    policy: {
      writablePaths: policy.writablePaths,
      readonlyPaths: [...policy.readonlyPaths, ...(run.environment?.paths ?? []), ...run.skills.paths],
      deniedPaths: policy.deniedPaths,
      allowedCommands: [...policy.allowedCommands, ...run.scriptCommands],
    },
    ...(profile.connectionConfig ? { providerConfig: profile.connectionConfig } : {}),
  });
  // A run may not exceed the policy's time limit: past it, the engine is stopped and the task made available again.
  const minutes =
    Number.isFinite(policy.maxExecutionMinutes) && policy.maxExecutionMinutes > 0 ? policy.maxExecutionMinutes : 30;
  const deadline = setTimeout(() => void expire(k, execution.id, minutes), minutes * 60_000);
  deadline.unref?.();
  k.deadlines.set(execution.id, deadline);
  void consume(k, execution, stream);
  return execution;
}

function taskPrompt(k: ExecutionKernel, plan: StartPlan, run: PreparedRun): string {
  const { input, previous } = plan;
  const environment =
    run.environment && run.installedEnvironment
      ? `${describeEnvironment(run.environment, run.scriptCommands)}\n\n`
      : '';
  const skills = run.skills.notes.length ? `# Skills de la app\n${run.skills.notes.join('\n')}\n\n` : '';
  return (
    environment +
    skills +
    buildTaskPrompt(
      plan.profile.systemInstructions,
      plan.group.map(task => ({
        displayKey: task.displayKey,
        title: task.title,
        summary: task.summary,
        acceptanceCriteria: task.acceptanceCriteria.map(item => item.description),
      })),
      run.context.packageText,
      plan.policy,
      previous
        ? { feedback: input.feedback!.trim(), previousSummary: previous.resultSummary, previousCommit: plan.startPoint }
        : undefined,
      input.retryContext,
      featurePlan(k, input.projectId, plan.groupIds),
    )
  );
}

/** A start that failed before the engine ran: the record is FAILED with the reason and the worktree is given back. */
async function failStart(
  k: ExecutionKernel,
  execution: AgentExecution,
  repositoryRoot: string,
  isolated: Isolated | null,
  error: unknown,
): Promise<AgentExecution> {
  const current = k.repository.findExecution(execution.id);
  if (!current || terminalStatuses.has(current.status))
    return isolated
      ? await discardIsolation(k, current ?? execution, repositoryRoot, isolated)
      : (current ?? execution);
  const failedEvent: AgentEvent = {
    type: 'EXECUTION_FAILED',
    timestamp: new Date().toISOString(),
    errorCode: 'EXECUTION_PREPARATION_FAILED',
    errorMessage: error instanceof Error ? error.message : String(error),
    isRecoverable: true,
  };
  await persistAndEmit(k, execution, failedEvent);
  let failed = transitionExecution(current, 'FAILED');
  failed = { ...failed, resultSummary: failedEvent.errorMessage, completedAt: new Date().toISOString() };
  k.repository.updateExecution(failed);
  publishStatus(k, failed);
  // The agent never ran, so the worktree holds nothing worth reviewing.
  return isolated ? await discardIsolation(k, failed, repositoryRoot, isolated) : failed;
}
