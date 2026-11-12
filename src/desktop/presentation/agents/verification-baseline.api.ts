import type { VerificationBaselineDto } from '../../../shared/contracts/verification-baseline.js';

/** Plan REP, R2: the verification baseline of the project's repository. */
export const verificationBaselineApi = {
  available: () => Boolean(window.workspaceIpc.commands.getVerificationBaseline),
  get(projectId: string): Promise<VerificationBaselineDto> {
    const command = window.workspaceIpc.commands.getVerificationBaseline;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede leer la línea base.'));
    return command(projectId);
  },
  run(projectId: string, commands?: string[]): Promise<VerificationBaselineDto> {
    const command = window.workspaceIpc.commands.runVerificationBaseline;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede comprobar la verificación.'));
    return command(projectId, commands);
  },
  acceptKnown(projectId: string, commands: string[]): Promise<VerificationBaselineDto> {
    const command = window.workspaceIpc.commands.acceptKnownFailures;
    if (!command) return Promise.reject(new Error('Esta versión de la app no puede aceptar fallos conocidos.'));
    return command(projectId, commands);
  },
};
