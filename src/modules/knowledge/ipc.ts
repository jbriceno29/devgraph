import type { GraphFilterDto } from '../../shared/contracts/ipc-contracts.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { ProjectRepositoryPort } from '../projects/index.js';
import { GetGraphViewUseCase } from './application/get-graph-view.js';
import type {
  DecisionStatusRepositoryPort,
  KnowledgeGraphRepositoryPort,
} from './application/ports/knowledge-graph-repository-port.js';
import { SetDecisionStatusUseCase } from './application/set-decision-status.js';

export interface KnowledgeIpcDeps {
  store: {
    openProject(id: string): {
      projects: ProjectRepositoryPort;
      graph: KnowledgeGraphRepositoryPort & DecisionStatusRepositoryPort;
    };
  };
  emit(channel: string, payload: unknown): void;
}

/** The graph as the interface draws it, and the status of decisions (ADR). */
export function knowledgeHandlers(d: KnowledgeIpcDeps): IpcHandlers {
  return {
    'graph:get_view': ([projectId, filter]) => {
      const workspace = d.store.openProject(text(projectId));
      return new GetGraphViewUseCase(workspace.projects, workspace.graph).execute(
        text(projectId),
        filter as GraphFilterDto | undefined,
      );
    },
    'decision:set_status': serial(([projectId, decisionId, status]) => {
      const id = text(projectId);
      const result = new SetDecisionStatusUseCase(d.store.openProject(id).graph).execute(
        id,
        text(decisionId),
        text(status),
      );
      d.emit('graph:revision_updated', { projectId: id, revision: result.revision });
      return result;
    }),
  };
}
