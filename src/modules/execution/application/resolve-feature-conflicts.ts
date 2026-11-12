import type { ResolveFeatureConflictsResultDto } from '../../../shared/contracts/feature-conflicts.js';
import type {
  FeatureCatalogPort,
  FeatureConflictGitPort,
  FeatureRef,
  FeatureTaskPort,
} from './ports/feature-conflict-port.js';

/**
 * «Resolver con un agente»: merges the target branch into the finished feature, commits the conflict markers and creates
 * a READY task of the feature that resolves them. The task runs, is verified and accepted like any other, so the work
 * already done is kept; once it is accepted the feature integrates cleanly. A retry after a failed task creation reuses
 * the markers already committed.
 */
export class ResolveFeatureConflicts {
  constructor(
    private readonly git: FeatureConflictGitPort,
    private readonly catalog: FeatureCatalogPort,
    private readonly tasks: FeatureTaskPort,
    private readonly workspaceRoot: string,
  ) {}

  async execute(projectId: string, featureId: string): Promise<ResolveFeatureConflictsResultDto> {
    const feature = this.catalog.features(projectId).find(item => item.id === featureId);
    if (!feature) throw new Error('La entidad seleccionada no es una feature de este proyecto.');
    const repositoryRoot = this.catalog.repositoryRoot(projectId);
    if (!repositoryRoot) throw new Error('Configura primero un repositorio Git para este proyecto.');
    const state = this.catalog.integration(projectId, featureId);
    if (!state)
      throw new Error(`${feature.displayKey} no tiene rama de integración: ninguna de sus tareas se ejecutó.`);
    if (state.openTaskCount)
      throw new Error(`${feature.displayKey} aún tiene tareas pendientes; termínalas antes de resolver el conflicto.`);
    const target = state.targetBranch;
    if (!target) throw new Error(`No se sabe en qué rama se integra ${feature.displayKey}.`);
    const pending = await this.git.filesWithMarkers(repositoryRoot, state.branchName, target);
    const merged = pending.length
      ? { commit: '', conflicts: pending }
      : await this.git.mergeWithConflicts({
          repositoryRoot,
          workspaceRoot: this.workspaceRoot,
          projectId,
          branch: state.branchName,
          sourceRef: target,
          message: `Incorpora ${target} en ${state.branchName} con conflictos por resolver (${feature.displayKey})`,
        });
    const task = await this.tasks.create(projectId, featureId, conflictTask(feature, target, merged.conflicts));
    return {
      featureId,
      workItemId: task.id,
      workItemKey: task.displayKey,
      files: merged.conflicts,
      commit: merged.commit,
    };
  }
}

/** The task the agent receives: which files, where the markers come from and which side wins on design. */
export function conflictTask(feature: FeatureRef, target: string, files: string[]) {
  const list = files.join(', ');
  return {
    title: `Resolver conflictos con ${target}`,
    summary: [
      `La rama de ${feature.displayKey} («${feature.title}») ya incorpora ${target}, pero estos archivos quedaron con marcadores de conflicto (<<<<<<<, =======, >>>>>>>): ${list}.`,
      `Lo que ya está en ${target} manda: otras features pueden depender de su diseño. Adapta el código y las pruebas de ${feature.displayKey} a ese diseño sin perder su comportamiento.`,
      'No borres funcionalidad de ninguno de los dos lados salvo que sea un duplicado exacto.',
    ].join(' '),
    acceptanceCriteria: [
      `Ningún archivo conserva marcadores de conflicto (${list})`,
      `Se conserva el diseño ya integrado en ${target} y ${feature.displayKey} funciona sobre él`,
      'Las pruebas de las dos partes pasan',
    ],
  };
}
