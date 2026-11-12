import type { AgentExecution } from '../domain/models.js';
import { type ExecutionKernel, closedStatuses, publishStatus } from './execution-kernel.js';

/**
 * The integration branch of the task's feature (or of the task itself when it has no feature), created on first use.
 * A feature branch starts from the user's HEAD plus the branches of the features it depends on (merged in a throwaway
 * worktree), so a dependent feature sees their code; a branch already started is brought up to date the same way.
 * Refused while a feature it depends on has open tasks. A failed creation leaves no branch behind.
 */
export async function integrationBranchFor(
  k: ExecutionKernel,
  projectId: string,
  workItem: { id: string; displayKey: string; title: string },
  repositoryRoot: string,
  repositoryId: string,
): Promise<string> {
  const feature = k.repository.findFeatureFor(projectId, workItem.id);
  const owner = feature ?? workItem;
  const blocker = feature ? featureBlocker(k, projectId, feature.id) : null;
  if (blocker) throw new Error(blocker);
  const dependencies = feature ? k.repository.listFeatureDependencies(projectId, feature.id) : [];
  const existing = k.repository.getIntegrationBranch(owner.id);
  if (existing && (await k.isolation.branchExists(repositoryRoot, existing.branchName))) {
    await mergeDependencies(k, projectId, repositoryRoot, existing.branchName, dependencies);
    return existing.branchName;
  }
  const sourceBranch = await k.isolation.baseBranch(repositoryRoot);
  const branchName = await k.isolation.createIntegrationBranch({
    repositoryRoot,
    preferredName: `graphdev/feature/${branchSlug(owner.displayKey, owner.title)}`,
    sourceRef: sourceBranch ?? 'HEAD',
  });
  try {
    await mergeDependencies(k, projectId, repositoryRoot, branchName, dependencies);
  } catch (error) {
    await k.isolation.deleteIntegrationBranch(repositoryRoot, branchName).catch(() => undefined);
    throw error;
  }
  k.repository.saveIntegrationBranch({
    ownerId: owner.id,
    projectId,
    repositoryId,
    branchName,
    sourceBranch: sourceBranch ?? 'HEAD',
  });
  return branchName;
}

/** Merges into `target` the branch of each dependency it does not contain yet (one already in the base is skipped). */
export async function mergeDependencies(
  k: ExecutionKernel,
  projectId: string,
  repositoryRoot: string,
  target: string,
  dependencies: Array<{ id: string; displayKey: string; title: string }>,
): Promise<void> {
  for (const dependency of dependencies) {
    const branch = k.repository.getIntegrationBranch(dependency.id)?.branchName;
    if (
      !branch ||
      !(await k.isolation.branchExists(repositoryRoot, branch)) ||
      (await k.isolation.isAncestor(repositoryRoot, branch, target))
    )
      continue;
    const result = await k.isolation.mergeInto({
      repositoryRoot,
      workspaceRoot: k.workspaceRoot,
      projectId,
      targetBranch: target,
      sourceRef: branch,
      message: `Incorpora ${branch} (${dependency.displayKey}: ${dependency.title}) en ${target}`,
    });
    if (!result.ok)
      throw new Error(
        `No se pudo incorporar el trabajo de ${dependency.displayKey} (${dependency.title}) en ${target}: ${result.detail}${result.conflicts.length ? ` Archivos en conflicto: ${result.conflicts.join(', ')}.` : ''} Resuélvelo a mano en ${target} o integra antes las features en la rama base.`,
      );
  }
}

/**
 * Why a feature cannot run yet: a feature it depends on (DEPENDS_ON between features, or a task of it that another
 * task of this feature depends on) still has open tasks. Null when it can run.
 */
export function featureBlocker(k: ExecutionKernel, projectId: string, featureId: string): string | null {
  const feature = k.repository.findFeatureFor(projectId, featureId);
  if (!feature) return null;
  const reasons = k.repository.listFeatureDependencies(projectId, feature.id).flatMap(dependency => {
    const pending = k.repository
      .listFeatureTasks(projectId, dependency.id)
      .filter(task => !closedStatuses.has(task.status));
    return pending.length
      ? [
          `${feature.displayKey} depende de ${dependency.title}, que aún tiene tareas pendientes: ${pending.map(task => task.displayKey).join(', ')}.`,
        ]
      : [];
  });
  return reasons.length ? reasons.join(' ') : null;
}

/** The feature's integration branch and open tasks, from the workspace only (null without a branch). */
export function featureIntegration(
  k: ExecutionKernel,
  projectId: string,
  featureId: string,
): import('../../../shared/contracts/agent-view.js').FeatureIntegrationStateDto | null {
  const branch = k.repository.getIntegrationBranch(featureId);
  if (!branch) return null;
  const tasks = k.repository.listFeatureTasks(projectId, featureId);
  return {
    branchName: branch.branchName,
    targetBranch: branch.sourceBranch && branch.sourceBranch !== 'HEAD' ? branch.sourceBranch : null,
    integratedAt: branch.integratedAt ?? null,
    taskCount: tasks.length,
    openTaskCount: tasks.filter(task => !closedStatuses.has(task.status)).length,
  };
}

/** Graph documents (D6) live on the base branch; only stale copies go into the integration branch (plan GIT, G2). */
export async function syncDocuments(
  k: ExecutionKernel,
  projectId: string,
  repositoryRoot: string,
  integrationBranch: string,
): Promise<void> {
  const paths = k.repository.listDocumentPaths(projectId);
  if (!paths.length) return;
  const dirty = await k.isolation.uncommittedPaths(repositoryRoot, paths);
  if (dirty.length)
    throw new Error(
      `Hay documentos del grafo sin commitear: ${dirty.join(', ')}. Guárdalos desde la app o commitéalos para que el agente los vea.`,
    );
  const base = (await k.isolation.baseBranch(repositoryRoot)) ?? 'HEAD';
  const stale = await k.isolation.pathsDiffer(repositoryRoot, integrationBranch, base, paths);
  if (!stale.length) return;
  const result = await k.isolation.copyPaths({
    repositoryRoot,
    workspaceRoot: k.workspaceRoot,
    projectId,
    targetBranch: integrationBranch,
    sourceRef: base,
    paths: stale,
    message: `Actualiza ${integrationBranch} con los documentos de ${base}`,
  });
  if (!result.ok)
    throw new Error(
      `No se pudo poner al día ${integrationBranch} con los documentos (${stale.join(', ')}): ${result.detail}`,
    );
}

/** Marks a run as superseded by a revision and drops its worktree; its commit lives on in the revision's branch. */
export async function supersede(
  k: ExecutionKernel,
  previous: AgentExecution,
  feedback: string,
  repositoryRoot: string,
): Promise<void> {
  let updated: AgentExecution = {
    ...previous,
    reviewStatus: 'CHANGES_REQUESTED',
    reviewNote: feedback,
    reviewedAt: new Date().toISOString(),
  };
  k.repository.updateExecution(updated);
  if (previous.branchOrWorktree && previous.executionBranch) {
    await k.isolation
      .discard({
        repositoryRoot,
        workspaceRoot: k.workspaceRoot,
        workingDirectory: previous.branchOrWorktree,
        branchName: previous.executionBranch,
      })
      .then(
        () => {
          updated = { ...updated, branchOrWorktree: null };
          k.repository.updateExecution(updated);
        },
        () => undefined,
      );
  }
  publishStatus(k, updated);
}

/** `feature/feat-001-crear-y-consultar-tareas`: ASCII, lowercase, safe for Git refs. */
export function branchSlug(displayKey: string, title: string): string {
  return (
    `${displayKey}-${title}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'feature'
  );
}
