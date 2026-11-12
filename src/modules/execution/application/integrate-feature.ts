import type { FeatureIntegrationResultDto } from '../../../shared/contracts/agent-view.js';
import type { FeatureChecksDto } from '../../../shared/contracts/feature-checks.js';
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
    /** Plan C6: the integration checks (a build) must have passed on the current branches. */
    private readonly checks?: (projectId: string, featureId: string) => Promise<FeatureChecksDto>,
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
    const checks = await this.checks?.(projectId, featureId);
    const blocked = checks && checksBlocker(key, target ?? 'la rama base', checks);
    if (blocked) throw new Error(blocked);
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

/** Why «Integrar» must wait for the integration checks (plan C6); null when they passed or there are none. */
export function checksBlocker(key: string, target: string, checks: FeatureChecksDto): string | null {
  const list = checks.commands.join(', ');
  switch (checks.status) {
    case 'NOT_RUN':
      return `${key} aún no pasó las comprobaciones de integración (${list}). Pulsa «Comprobar antes de integrar».`;
    case 'RUNNING':
      return `Las comprobaciones de integración de ${key} siguen en marcha; espera a que terminen.`;
    case 'FAILED':
      return `${key} no pasó las comprobaciones de integración (${list}) y ${target} no se tocó. Revisa el resultado y corrige la feature con una tarea.`;
    case 'STALE':
      return `${key} o ${target} cambiaron desde la última comprobación. Vuelve a comprobar antes de integrar.`;
    default:
      return null;
  }
}
