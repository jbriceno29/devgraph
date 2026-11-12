import type {
  FeatureConflictsDto,
  ResolveFeatureConflictsResultDto,
} from '../../../shared/contracts/feature-conflicts.js';

/** Plan UX, F0b: conflicts of a finished feature (read-only) and «Resolver con un agente». */
export const featureConflictsApi = {
  available: () => Boolean(window.workspaceIpc.commands.checkFeatureConflicts),
  check(projectId: string, featureId: string): Promise<FeatureConflictsDto> {
    const command = window.workspaceIpc.commands.checkFeatureConflicts;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede revisar conflictos.'));
    return command(projectId, featureId);
  },
  resolve(projectId: string, featureId: string): Promise<ResolveFeatureConflictsResultDto> {
    const command = window.workspaceIpc.commands.resolveFeatureConflicts;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede resolver conflictos.'));
    return command(projectId, featureId);
  },
};
