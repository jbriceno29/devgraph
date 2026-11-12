import type { FeatureChecksDto } from '../../../shared/contracts/feature-checks.js';
import type { FeatureCheckRegistry } from './feature-check-registry.js';
import type { FeatureCatalogPort } from './ports/feature-conflict-port.js';
import type { FeatureCheckRunnerPort, IntegrationCommandsPort } from './ports/feature-check-port.js';

/** Plan C6: where the integration checks of a feature stand, and whether they still hold for the current branches. */
export class GetFeatureChecks {
  constructor(
    private readonly registry: FeatureCheckRegistry,
    private readonly catalog: FeatureCatalogPort,
    private readonly runner: FeatureCheckRunnerPort,
    private readonly integrationCommands: IntegrationCommandsPort,
  ) {}

  async execute(projectId: string, featureId: string): Promise<FeatureChecksDto> {
    const empty = { featureId, checks: [], detail: null, checkedAt: null };
    const state = this.catalog.integration(projectId, featureId),
      root = this.catalog.repositoryRoot(projectId);
    if (!state || !root || !state.targetBranch) return { ...empty, status: 'NONE', commands: [] };
    const entry = this.registry.get(projectId, featureId);
    if (entry?.state === 'RUNNING') return { ...empty, status: 'RUNNING', commands: entry.commands };
    const commands = await this.integrationCommands.commands(projectId, state.branchName);
    if (!commands.length) return { ...empty, status: 'NONE', commands };
    if (!entry) return { ...empty, status: 'NOT_RUN', commands };
    const heads = await this.runner.heads(root, state.targetBranch, state.branchName).catch(() => null);
    // A run that failed before reaching git (no commits recorded) stays FAILED until it is run again.
    const current =
      !entry.run.baseCommit ||
      (heads?.base === entry.run.baseCommit &&
        heads.feature === entry.run.featureCommit &&
        entry.commands.join('\n') === commands.join('\n'));
    return {
      featureId,
      status: !current ? 'STALE' : entry.run.passed ? 'PASSED' : 'FAILED',
      commands,
      checks: entry.run.checks,
      detail: entry.run.detail,
      checkedAt: entry.checkedAt,
    };
  }
}
