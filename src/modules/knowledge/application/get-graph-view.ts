import type { KnowledgeGraphRepositoryPort } from './ports/knowledge-graph-repository-port.js';
import type { ProjectRepositoryPort } from '../../projects/index.js';
import type { GraphFilterDto, GraphViewDto } from '../../../shared/contracts/ipc-contracts.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../../shared/contracts/graph-view.js';
export class GetGraphViewUseCase {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly graph: KnowledgeGraphRepositoryPort,
  ) {}
  execute(projectId: string, filter?: GraphFilterDto): GraphViewDto {
    const project = this.projects.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const entities = this.graph.listEntities(projectId);
    const allowedNodes = filter?.entityTypes ? new Set<KnowledgeEntityType>(filter.entityTypes) : null;
    const visible = entities.filter(entity => !allowedNodes || allowedNodes.has(entity.entityType));
    const visibleIds = new Set(visible.map(entity => entity.id));
    const edges = this.graph
      .listRelationships(projectId)
      .filter(
        edge =>
          visibleIds.has(edge.sourceId) &&
          visibleIds.has(edge.targetId) &&
          (!filter?.edgeTypes || filter.edgeTypes.includes(edge.edgeType)),
      );
    return {
      projectId,
      revision: project.currentRevision,
      nodes: visible.map(entity => ({
        id: entity.id,
        key: entity.displayKey,
        type: entity.entityType,
        label: entity.title,
        status: entity.status,
        ...(entity.parentId ? { parentId: entity.parentId } : {}),
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.edgeType as GraphEdgeType,
        provenance: edge.provenance,
      })),
    };
  }
}
