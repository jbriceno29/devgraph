import type { KnowledgeEntity, GraphRelationship } from '../../domain/graph/knowledge-entity.js';
export interface KnowledgeEntityDetails {
  entity: KnowledgeEntity;
  attributes: Record<string, unknown>;
}
export interface ExecutionHistoryRecord {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
}
export interface KnowledgeGraphRepositoryPort {
  findEntityById(id: string): KnowledgeEntity | null;
  findEntityDetailsById(id: string): KnowledgeEntityDetails | null;
  findExecutionHistory(entityId: string): ExecutionHistoryRecord[];
  listEntities(projectId: string): KnowledgeEntity[];
  listRelationships(projectId: string): GraphRelationship[];
  insertEntity(entity: KnowledgeEntity): void;
  insertRelationship(edge: GraphRelationship): void;
}
/** Status changes of decision records, made by the user from the inspector. */
export interface DecisionStatusRepositoryPort {
  findEntityById(id: string): KnowledgeEntity | null;
  /** Sets the status when it is still `from` (else throws), stamps decided_at on ACCEPTED, bumps and returns the revision. */
  setDecisionStatus(projectId: string, decisionId: string, from: string, to: string): number;
}
