import type { FeatureChecksDto } from '../../../shared/contracts/feature-checks.js';

/** Plan C6: the integration checks (a build) of a finished feature. */
export const featureChecksApi = {
  available: () => Boolean(window.workspaceIpc.commands.getFeatureChecks),
  get(projectId: string, featureId: string): Promise<FeatureChecksDto> {
    const command = window.workspaceIpc.commands.getFeatureChecks;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede leer las comprobaciones.'));
    return command(projectId, featureId);
  },
  run(projectId: string, featureId: string): Promise<FeatureChecksDto> {
    const command = window.workspaceIpc.commands.runFeatureChecks;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede lanzar las comprobaciones.'));
    return command(projectId, featureId);
  },
};
