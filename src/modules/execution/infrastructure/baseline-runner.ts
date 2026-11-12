import { withBaseCheckout } from './base-checkout.js';
import type { FeatureCheckDependencies } from './feature-checks.js';
import { runChecks } from './run-checks.js';

/**
 * Plan REP, R2: runs the project's checks once on a throwaway copy of its base branch (under `checks/`, like C6), with
 * the environment installed the usual way (no install scripts). No branch moves and the user's checkout is not read.
 */
export class GitBaselineRunner {
  constructor(
    private readonly deps: FeatureCheckDependencies & {
      repositoryOf(projectId: string): string | null;
      configuredBase(projectId: string): string | null;
    },
  ) {}

  async run(input: { projectId: string; commands: string[] }) {
    const path = this.deps.repositoryOf(input.projectId);
    if (!path) throw new Error('El proyecto no tiene repositorio configurado.');
    const checkout = {
      repositoryPath: path,
      configuredBase: this.deps.configuredBase(input.projectId),
      workspaceRoot: this.deps.workspaceRoot,
      projectId: input.projectId,
    };
    return withBaseCheckout(checkout, async (directory, { ref, commit }) => {
      const environment = this.deps.environmentFor(input.projectId);
      if (environment)
        try {
          await this.deps.installer.provision({ workingDirectory: directory, projectName: 'baseline', environment });
        } catch (error) {
          return {
            ref,
            commit,
            results: [],
            error: `No se pudieron instalar las dependencias: ${(error as Error).message}`,
          };
        }
      const report = await runChecks(directory, input.commands, {
        ...process.env,
        CI: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      });
      return { ref, commit, results: report.results };
    });
  }
}
