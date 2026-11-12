import { type ExecutionKernel, closedStatuses } from './execution-kernel.js';

/**
 * Integrates a finished feature into the project's base branch (the branch its integration branch was created from)
 * with a merge commit, so the features that depend on it simply start from the updated base. Refused with open tasks,
 * with uncommitted changes in the user's checkout of that branch, or on conflict. The feature branch is kept.
 */
export async function integrateFeature(
  k: ExecutionKernel,
  projectId: string,
  featureId: string,
): Promise<{
  featureId: string;
  branchName: string;
  targetBranch: string;
  merged: boolean;
  alreadyIntegrated: boolean;
  commit: string | null;
}> {
  const { feature, repositoryRoot, branch, targetBranch } = await integrable(k, projectId, featureId);
  const base = { featureId: feature.id, branchName: branch.branchName, targetBranch };
  if (k.accepting.has(`feature:${feature.id}`)) throw new Error(`${feature.displayKey} ya se está integrando.`);
  k.accepting.add(`feature:${feature.id}`);
  try {
    const mark = () => k.repository.setFeatureIntegrated?.(projectId, branch.branchName, new Date().toISOString());
    if (await k.isolation.isAncestor(repositoryRoot, branch.branchName, targetBranch)) {
      mark();
      return { ...base, merged: false, alreadyIntegrated: true, commit: null };
    }
    const result = await k.isolation.mergeIntoBase({
      repositoryRoot,
      workspaceRoot: k.workspaceRoot,
      projectId,
      targetBranch,
      sourceRef: branch.branchName,
      message: `Integra ${branch.branchName} (${feature.displayKey}: ${feature.title}) en ${targetBranch}`,
    });
    if (!result.ok)
      throw new Error(
        `No se pudo integrar ${feature.displayKey} en ${targetBranch}: ${result.detail}${result.conflicts.length ? ` (${result.conflicts.join(', ')})` : ''}`,
      );
    mark();
    return { ...base, merged: result.changed, alreadyIntegrated: !result.changed, commit: result.commit };
  } finally {
    k.accepting.delete(`feature:${feature.id}`);
  }
}

/** A feature that can be integrated: all its tasks closed, its branch and its base branch still there. */
async function integrable(k: ExecutionKernel, projectId: string, featureId: string) {
  const feature = k.repository.findFeatureFor(projectId, featureId);
  if (!feature || feature.id !== featureId)
    throw new Error('La entidad seleccionada no es una feature de este proyecto.');
  const repositoryRoot = k.repository.getRepositoryRoot(projectId);
  if (!repositoryRoot) throw new Error('Configura primero un repositorio Git para este proyecto.');
  const tasks = k.repository.listFeatureTasks(projectId, feature.id);
  if (!tasks.length) throw new Error(`${feature.displayKey} no tiene tareas que integrar.`);
  const pending = tasks.filter(task => !closedStatuses.has(task.status));
  if (pending.length)
    throw new Error(
      `${feature.displayKey} aún tiene tareas pendientes: ${pending.map(task => task.displayKey).join(', ')}.`,
    );
  const branch = k.repository.getIntegrationBranch(feature.id);
  if (!branch || !(await k.isolation.branchExists(repositoryRoot, branch.branchName)))
    throw new Error(
      `${feature.displayKey} no tiene rama de integración: ninguna de sus tareas se ejecutó con Graph Workspace.`,
    );
  const targetBranch = branch.sourceBranch;
  if (!targetBranch || targetBranch === 'HEAD' || !(await k.isolation.branchExists(repositoryRoot, targetBranch)))
    throw new Error(
      `No se sabe en qué rama integrar ${feature.displayKey}: su rama ${branch.branchName} salió de ${targetBranch === 'HEAD' ? 'un HEAD sin rama' : `la rama ${targetBranch}, que ya no existe`}.`,
    );
  return { feature, repositoryRoot, branch, targetBranch };
}
