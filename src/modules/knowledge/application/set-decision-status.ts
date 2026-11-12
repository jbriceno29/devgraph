import type { DecisionStatusRepositoryPort } from './ports/knowledge-graph-repository-port.js';
import { canTransitionDecision, decisionTransitions, statusName } from '../domain/decision-status.js';

/** The user accepts, rejects, supersedes or reopens a decision record (ADR). */
export class SetDecisionStatusUseCase {
  constructor(private readonly graph: DecisionStatusRepositoryPort) {}
  execute(projectId: string, decisionId: string, to: string): { status: string; revision: number } {
    const decision = this.graph.findEntityById(decisionId);
    if (!decision || decision.projectId !== projectId || decision.entityType !== 'DECISION_RECORD')
      throw new Error('La decisión no existe en este proyecto.');
    if (!canTransitionDecision(decision.status, to)) {
      const allowed = decisionTransitions(decision.status);
      throw new Error(
        `${decision.displayKey} está ${statusName(decision.status)}: ${allowed.length ? `solo puede pasar a ${allowed.map(statusName).join(' o ')}` : 'ya no admite cambios'}.`,
      );
    }
    return { status: to, revision: this.graph.setDecisionStatus(projectId, decisionId, decision.status, to) };
  }
}
