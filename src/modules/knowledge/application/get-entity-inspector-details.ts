import type { KnowledgeGraphRepositoryPort } from './ports/knowledge-graph-repository-port.js';
import { readableResultSummary } from '../../execution/index.js';
import type { EntityInspectorDto } from '../../../shared/contracts/ipc-contracts.js';
export class GetEntityInspectorDetailsUseCase {
  constructor(private readonly graph: KnowledgeGraphRepositoryPort) {}
  execute(entityId: string): EntityInspectorDto {
    const details = this.graph.findEntityDetailsById(entityId);
    if (!details) throw new Error(`Entity not found: ${entityId}`);
    const { entity } = details;
    const labelById = new Map(this.graph.listEntities(entity.projectId).map(item => [item.id, item.title]));
    const relationships = this.graph.listRelationships(entity.projectId).flatMap(edge => {
      const direction: 'OUTGOING' | 'INCOMING' | null =
        edge.sourceId === entityId ? 'OUTGOING' : edge.targetId === entityId ? 'INCOMING' : null;
      if (!direction) return [];
      return [
        {
          id: edge.id,
          sourceId: edge.sourceId,
          sourceLabel: labelById.get(edge.sourceId) ?? edge.sourceId,
          targetId: edge.targetId,
          targetLabel: labelById.get(edge.targetId) ?? edge.targetId,
          type: edge.edgeType,
          direction,
          provenance: edge.provenance,
        },
      ];
    });
    return {
      entity: {
        id: entity.id,
        key: entity.displayKey,
        type: entity.entityType,
        label: entity.title,
        status: entity.status,
        summary: entity.summary,
        ...(entity.parentId ? { parentId: entity.parentId } : {}),
      },
      attributes: details.attributes,
      relationships,
      executionHistory: this.graph
        .findExecutionHistory(entityId)
        .map(run => ({ ...run, resultSummary: readableResultSummary(run.resultSummary) })),
    };
  }
}
