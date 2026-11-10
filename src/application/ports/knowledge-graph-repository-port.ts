import type { KnowledgeEntity, GraphRelationship } from '../../domain/graph/knowledge-entity.js';
export interface KnowledgeEntityDetails { entity:KnowledgeEntity; attributes:Record<string,unknown> }
export interface ExecutionHistoryRecord { id:string; status:string; startedAt:string|null; completedAt:string|null; resultSummary:string|null }
export interface KnowledgeGraphRepositoryPort {
  findEntityById(id:string):KnowledgeEntity|null;
  findEntityDetailsById(id:string):KnowledgeEntityDetails|null;
  findExecutionHistory(entityId:string):ExecutionHistoryRecord[];
  listEntities(projectId:string):KnowledgeEntity[];
  listRelationships(projectId:string):GraphRelationship[];
  insertEntity(entity:KnowledgeEntity):void;
  insertRelationship(edge:GraphRelationship):void;
}
