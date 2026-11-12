import type { FeatureChecksDto } from '../../../shared/contracts/feature-checks.js';
import type { FeatureCheckRegistry } from './feature-check-registry.js';
import type { GetFeatureChecks } from './get-feature-checks.js';
import type { FeatureCatalogPort } from './ports/feature-conflict-port.js';
import type { FeatureCheckRunnerPort, IntegrationCommandsPort } from './ports/feature-check-port.js';

/**
 * Plan C6: starts the integration checks of a finished feature (a build takes minutes) and returns at once; the result
 * lands in the registry, where «Integrar» looks for it.
 */
export class RunFeatureChecks {
  constructor(
    private readonly registry: FeatureCheckRegistry,
    private readonly catalog: FeatureCatalogPort,
    private readonly runner: FeatureCheckRunnerPort,
    private readonly integrationCommands: IntegrationCommandsPort,
    private readonly status: GetFeatureChecks,
  ) {}

  async execute(projectId: string, featureId: string): Promise<FeatureChecksDto> {
    const state = this.catalog.integration(projectId, featureId),
      repositoryRoot = this.catalog.repositoryRoot(projectId);
    if (!state || !repositoryRoot || !state.targetBranch)
      throw new Error('La feature aún no tiene rama de integración: acepta primero alguna de sus tareas.');
    if (this.registry.get(projectId, featureId)?.state === 'RUNNING') return this.status.execute(projectId, featureId);
    const commands = await this.integrationCommands.commands(projectId, state.branchName);
    if (!commands.length) return this.status.execute(projectId, featureId);
    this.registry.set(projectId, featureId, { state: 'RUNNING', commands });
    const input = { projectId, repositoryRoot, targetBranch: state.targetBranch, branch: state.branchName, commands };
    void this.runner.run(input).then(
      run =>
        this.registry.set(projectId, featureId, { state: 'DONE', commands, run, checkedAt: new Date().toISOString() }),
      error =>
        this.registry.set(projectId, featureId, {
          state: 'DONE',
          commands,
          checkedAt: new Date().toISOString(),
          run: {
            passed: false,
            checks: [],
            detail: error instanceof Error ? error.message : String(error),
            baseCommit: '',
            featureCommit: '',
          },
        }),
    );
    return this.status.execute(projectId, featureId);
  }
}
