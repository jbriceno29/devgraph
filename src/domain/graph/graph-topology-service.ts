import { DomainError } from '../../shared/types/domain-error.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../shared/contracts/graph-view.js';
import type { KnowledgeEntity, GraphRelationship } from './knowledge-entity.js';
type Pair = readonly [KnowledgeEntityType, KnowledgeEntityType];
const COMPATIBILITY: Readonly<Record<GraphEdgeType, readonly Pair[]>> = {
  DEPENDS_ON: [['WORK_ITEM','WORK_ITEM'],['FEATURE','FEATURE'],['MODULE','MODULE']],
  IMPLEMENTS: [['WORK_ITEM','FEATURE'],['WORK_ITEM','REQUIREMENT']],
  SATISFIES: [['FEATURE','REQUIREMENT']],
  AFFECTS: [['DECISION_RECORD','PROJECT_ROOT'],['DECISION_RECORD','MODULE'],['DECISION_RECORD','FEATURE'],['DECISION_RECORD','WORK_ITEM'],['DECISION_RECORD','REQUIREMENT']],
  SUPERSEDES: [['DECISION_RECORD','DECISION_RECORD']],
  DOCUMENTED_BY: [['PROJECT_ROOT','ARTIFACT'],['MODULE','ARTIFACT'],['FEATURE','ARTIFACT'],['REQUIREMENT','ARTIFACT'],['WORK_ITEM','ARTIFACT']],
  VERIFIED_BY: [['REQUIREMENT','ARTIFACT'],['REQUIREMENT','CODE_REFERENCE'],['FEATURE','ARTIFACT'],['FEATURE','CODE_REFERENCE'],['WORK_ITEM','ARTIFACT'],['WORK_ITEM','CODE_REFERENCE']],
  TOUCHES_CODE: [['MODULE','CODE_REFERENCE'],['FEATURE','CODE_REFERENCE'],['WORK_ITEM','CODE_REFERENCE'],['DECISION_RECORD','CODE_REFERENCE']],
  MODIFIES: [['WORK_ITEM','CODE_REFERENCE']],
  GENERATED_BY: [['ARTIFACT','WORK_ITEM'],['DECISION_RECORD','WORK_ITEM']],
  SCOPED_IN: [['FEATURE','MILESTONE'],['WORK_ITEM','MILESTONE']],
};
const DAG_EDGE_TYPES = new Set<GraphEdgeType>(['DEPENDS_ON','SUPERSEDES']);
export class GraphTopologyService {
  validateParent(entity: KnowledgeEntity, parent: KnowledgeEntity | null, allEntities: readonly KnowledgeEntity[]): void {
    if (parent && parent.projectId !== entity.projectId) throw new DomainError('CROSS_PROJECT_PARENT', 'Parent and child must belong to the same project.');
    const valid = parent === null ? entity.entityType === 'PROJECT_ROOT' || entity.entityType === 'REQUIREMENT' || entity.entityType === 'DECISION_RECORD' || entity.entityType === 'ARTIFACT' || entity.entityType === 'CODE_REFERENCE'
      : (parent.entityType === 'PROJECT_ROOT' && ['MODULE','REQUIREMENT','DECISION_RECORD','ARTIFACT','CODE_REFERENCE'].includes(entity.entityType))
      || (parent.entityType === 'MODULE' && ['MODULE','FEATURE','DECISION_RECORD','ARTIFACT','CODE_REFERENCE'].includes(entity.entityType))
      || (parent.entityType === 'FEATURE' && ['WORK_ITEM'].includes(entity.entityType))
      || (parent.entityType === 'WORK_ITEM' && entity.entityType === 'WORK_ITEM' && allEntities.find(e => e.id === parent.parentId)?.entityType !== 'WORK_ITEM' && !allEntities.some(e => e.parentId === parent.id && e.entityType === 'WORK_ITEM'));
    if (!valid) throw new DomainError('INCOMPATIBLE_PARENT', `${entity.entityType} cannot be placed under ${parent?.entityType ?? 'NULL'}.`);
    let cursor = parent;
    const visited = new Set<string>([entity.id]);
    while (cursor) {
      if (visited.has(cursor.id)) throw new DomainError('CYCLE_DETECTED', 'Parent hierarchy would contain a cycle.');
      visited.add(cursor.id);
      cursor = allEntities.find(e => e.id === cursor?.parentId) ?? null;
    }
  }
  validateEdge(source: KnowledgeEntity, target: KnowledgeEntity, type: GraphEdgeType, edges: readonly GraphRelationship[]): void {
    if (source.id === target.id) throw new DomainError('SELF_REFERENCE', 'An edge cannot connect an entity to itself.');
    if (source.projectId !== target.projectId) throw new DomainError('CROSS_PROJECT_EDGE', 'Both edge endpoints must belong to the same project.');
    if (!COMPATIBILITY[type].some(([s,t]) => s === source.entityType && t === target.entityType)) throw new DomainError('INCOMPATIBLE_EDGE', `${type} is not allowed from ${source.entityType} to ${target.entityType}.`);
    if (DAG_EDGE_TYPES.has(type)) {
      const adjacency = new Map<string,string[]>();
      for (const edge of edges) if (edge.edgeType === type) adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) ?? []), edge.targetId]);
      adjacency.set(source.id, [...(adjacency.get(source.id) ?? []), target.id]);
      const visiting = new Set<string>(), visited = new Set<string>();
      const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const next of adjacency.get(id) ?? []) if (visit(next)) return true; visiting.delete(id); visited.add(id); return false; };
      for (const id of adjacency.keys()) if (visit(id)) throw new DomainError('CYCLE_DETECTED', `${type} relationships must form a DAG.`);
    }
  }
}
export const edgeCompatibilityMatrix = COMPATIBILITY;
