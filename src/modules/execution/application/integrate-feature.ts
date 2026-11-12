import type { FeatureIntegrationResultDto } from '../../../shared/contracts/agent-view.js';
import type { FeatureCatalogPort, FeatureConflictGitPort } from './ports/feature-conflict-port.js';

type Integrate = (projectId: string, featureId: string) => Promise<FeatureIntegrationResultDto>;

/**
 * «Integrar en main» with the conflict cases spelled out: refused while the branch still has conflict markers, and a
 * conflict says which files collide and what to do next instead of the bare git error.
 */
export class IntegrateFeature {
  constructor(
    private readonly integrate: Integrate,
    private readonly git: FeatureConflictGitPort,
    private readonly catalog: FeatureCatalogPort,
  ) {}

  async execute(projectId: string, featureId: string): Promise<FeatureIntegrationResultDto> {
    const repositoryRoot = this.catalog.repositoryRoot(projectId);
    const state = this.catalog.integration(projectId, featureId);
    const target = state?.targetBranch;
    const key = this.catalog.features(projectId).find(item => item.id === featureId)?.displayKey ?? 'La feature';
    if (repositoryRoot && state && target) {
      const unresolved = await this.git.filesWithMarkers(repositoryRoot, state.branchName, target).catch(() => []);
      if (unresolved.length)
        throw new Error(
          `${key} aún tiene marcadores de conflicto en ${unresolved.join(', ')}. Termina y acepta la tarea que los resuelve antes de integrar.`,
        );
    }
    try {
      return await this.integrate(projectId, featureId);
    } catch (error) {
      if (!repositoryRoot || !state || !target) throw error;
      const files = await this.git.conflicts(repositoryRoot, target, state.branchName).catch(() => []);
      if (!files.length) throw error;
      throw new Error(
        `${key} y ${target} cambiaron los mismos archivos de forma distinta: ${files.join(', ')}. ${target} no se tocó. Pulsa «Resolver con un agente» en ${key}: una tarea juntará ${target} en la feature y resolverá el conflicto conservando lo ya integrado.`,
      );
    }
  }
}
