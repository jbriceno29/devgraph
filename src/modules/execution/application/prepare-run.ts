import type { AgentExecution } from '../domain/models.js';
import { type ExecutionKernel, discardIsolation } from './execution-kernel.js';
import type { Isolated, StartPlan } from './start-execution.js';

export interface PreparedRun {
  execution: AgentExecution;
  isolated: Isolated;
  environment: ReturnType<NonNullable<ExecutionKernel['environment']>['forProject']>;
  installedEnvironment: boolean;
  scriptCommands: string[];
  skillIds: string[];
  skills: { paths: string[]; notes: string[] };
  context: Awaited<ReturnType<ExecutionKernel['contextBuilder']['build']>>;
}

/**
 * After isolation: the environment, the skills and the context. A run cancelled meanwhile (its record no longer
 * PREPARING_CONTEXT) gives back its worktree instead.
 */
export async function prepareRun(
  k: ExecutionKernel,
  plan: StartPlan,
  started: AgentExecution,
  isolated: Isolated,
): Promise<PreparedRun | { discarded: AgentExecution }> {
  const cancelled = (fallback: AgentExecution) => {
    const latest = k.repository.findExecution(started.id);
    return latest && latest.status === 'PREPARING_CONTEXT' ? null : (latest ?? fallback);
  };
  const discard = async (current: AgentExecution) => ({
    discarded: await discardIsolation(k, current, plan.repositoryRoot, isolated),
  });
  const afterIsolation = cancelled(started);
  if (afterIsolation) return discard(afterIsolation);
  let execution: AgentExecution = {
    ...started,
    initialCommit: isolated.baseCommit,
    branchOrWorktree: isolated.workingDirectory,
    executionBranch: isolated.branchName,
    baseBranch: plan.previous ? plan.previous.baseBranch : isolated.baseBranch,
  };
  k.repository.updateExecution(execution);
  const installed = await installEnvironment(k, plan, execution, isolated);
  if (installed.cancelled) return discard(installed.cancelled);
  execution = installed.execution;
  const { skillIds, skills } = await provisionSkills(k, plan, isolated);
  const context = await k.contextBuilder.build({
    projectId: plan.input.projectId,
    focusEntityId: plan.workItem.id,
    ...(plan.groupIds.length > 1 ? { extraFocusEntityIds: plan.groupIds.slice(1) } : {}),
    repositoryRoot: plan.repositoryRoot,
    executionId: execution.id,
    sourceCommit: isolated.baseCommit,
  });
  const afterContext = cancelled(execution);
  if (afterContext) return discard(afterContext);
  return { ...installed, execution, isolated, skillIds, skills, context };
}

/** Plan S2: the app installs the stack's dependencies before the agent starts; a manifest it completes is committed apart. */
async function installEnvironment(k: ExecutionKernel, plan: StartPlan, execution: AgentExecution, isolated: Isolated) {
  const environment = k.environment?.forProject(plan.input.projectId) ?? null;
  // Whether the agent gets the environment section of the prompt: only when something was installed.
  let installedEnvironment = false;
  // Plan: with dependencies installed, the agent may also run the project's scripts (npm run <script>, npm test).
  let scriptCommands: string[] = [];
  if (!environment) return { execution, environment, installedEnvironment, scriptCommands, cancelled: null };
  const prepared = await k
    .environment!.provision({
      projectId: plan.input.projectId,
      executionId: execution.id,
      workingDirectory: isolated.workingDirectory,
      projectName: plan.repositoryRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'proyecto',
      environment,
    })
    .catch(error => {
      throw new Error(
        `No se pudo preparar el entorno del proyecto: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  const latest = k.repository.findExecution(execution.id);
  if (!latest || latest.status !== 'PREPARING_CONTEXT')
    return { execution, environment, installedEnvironment, scriptCommands, cancelled: latest ?? execution };
  installedEnvironment = prepared.installed !== false;
  if (installedEnvironment) scriptCommands = [`${prepared.manager ?? 'npm'} run`, `${prepared.manager ?? 'npm'} test`];
  if (prepared.commit) {
    execution = { ...execution, initialCommit: prepared.commit };
    k.repository.updateExecution(execution);
  }
  return { execution, environment, installedEnvironment, scriptCommands, cancelled: null };
}

/** Plan S4: interface work carries the skills that ship with the app, copied into the worktree (never committed). */
async function provisionSkills(k: ExecutionKernel, plan: StartPlan, isolated: Isolated) {
  const skillIds = k.skills
    ? await k.skills.select({
        projectId: plan.input.projectId,
        tasks: plan.group.map(task => ({ id: task.id, title: task.title, summary: task.summary })),
      })
    : [];
  const skills = skillIds.length
    ? await k.skills!.materialize({ workingDirectory: isolated.workingDirectory, skillIds })
    : { paths: [] as string[], notes: [] as string[] };
  return { skillIds, skills };
}
