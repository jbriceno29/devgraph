import type { AgentAccessProposalDto } from '../../../shared/contracts/repository-scan.js';

/** Plan REP, R1: writable paths and checks read from the project's repository (nothing is saved). */
export function proposeAccessFromRepository(projectId: string): Promise<AgentAccessProposalDto> {
  const query = window.workspaceIpc.queries.proposeAccessFromRepository;
  if (!query) return Promise.reject(new Error('Esta versión de la app no puede leer las rutas del repositorio.'));
  return query(projectId);
}
