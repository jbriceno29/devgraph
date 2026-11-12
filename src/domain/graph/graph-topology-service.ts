import { DomainError } from '../../shared/types/domain-error.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../shared/contracts/graph-view.js';
import type { KnowledgeEntity, GraphRelationship } from './knowledge-entity.js';
type Pair = readonly [KnowledgeEntityType, KnowledgeEntityType];
/** Which entity types each edge may join (source → target). The planner prompt is built from this same table. */
export const EDGE_COMPATIBILITY: Readonly<Record<GraphEdgeType, readonly Pair[]>> = {
  DEPENDS_ON: [
    ['WORK_ITEM', 'WORK_ITEM'],
    ['FEATURE', 'FEATURE'],
    ['MODULE', 'MODULE'],
  ],
  IMPLEMENTS: [
    ['WORK_ITEM', 'FEATURE'],
    ['WORK_ITEM', 'REQUIREMENT'],
  ],
  SATISFIES: [['FEATURE', 'REQUIREMENT']],
  AFFECTS: [
    ['DECISION_RECORD', 'PROJECT_ROOT'],
    ['DECISION_RECORD', 'MODULE'],
    ['DECISION_RECORD', 'FEATURE'],
    ['DECISION_RECORD', 'WORK_ITEM'],
    ['DECISION_RECORD', 'REQUIREMENT'],
    // An architecture decision may constrain a document (e.g. an ADR that changes docs/UI_SPEC.md); a real ecommerce plan proposed it.
    ['DECISION_RECORD', 'ARTIFACT'],
  ],
  SUPERSEDES: [['DECISION_RECORD', 'DECISION_RECORD']],
  DOCUMENTED_BY: [
    ['PROJECT_ROOT', 'ARTIFACT'],
    ['MODULE', 'ARTIFACT'],
    ['FEATURE', 'ARTIFACT'],
    ['REQUIREMENT', 'ARTIFACT'],
    ['WORK_ITEM', 'ARTIFACT'],
  ],
  VERIFIED_BY: [
    ['REQUIREMENT', 'ARTIFACT'],
    ['REQUIREMENT', 'CODE_REFERENCE'],
    ['FEATURE', 'ARTIFACT'],
    ['FEATURE', 'CODE_REFERENCE'],
    ['WORK_ITEM', 'ARTIFACT'],
    ['WORK_ITEM', 'CODE_REFERENCE'],
  ],
  TOUCHES_CODE: [
    ['MODULE', 'CODE_REFERENCE'],
    ['FEATURE', 'CODE_REFERENCE'],
    ['WORK_ITEM', 'CODE_REFERENCE'],
    ['DECISION_RECORD', 'CODE_REFERENCE'],
  ],
  MODIFIES: [['WORK_ITEM', 'CODE_REFERENCE']],
  GENERATED_BY: [
    ['ARTIFACT', 'WORK_ITEM'],
    ['DECISION_RECORD', 'WORK_ITEM'],
  ],
  SCOPED_IN: [
    ['FEATURE', 'MILESTONE'],
    ['WORK_ITEM', 'MILESTONE'],
  ],
};
const DAG_EDGE_TYPES = new Set<GraphEdgeType>(['DEPENDS_ON', 'SUPERSEDES']);
export class GraphTopologyService {
  validateParent(
    entity: KnowledgeEntity,
    parent: KnowledgeEntity | null,
    allEntities: readonly KnowledgeEntity[],
  ): void {
    if (parent && parent.projectId !== entity.projectId)
      throw new DomainError('CROSS_PROJECT_PARENT', 'Parent and child must belong to the same project.');
    const valid =
      parent === null
        ? entity.entityType === 'PROJECT_ROOT' ||
          entity.entityType === 'REQUIREMENT' ||
          entity.entityType === 'DECISION_RECORD' ||
          entity.entityType === 'ARTIFACT' ||
          entity.entityType === 'CODE_REFERENCE'
        : (parent.entityType === 'PROJECT_ROOT' &&
            ['MODULE', 'REQUIREMENT', 'DECISION_RECORD', 'ARTIFACT', 'CODE_REFERENCE'].includes(entity.entityType)) ||
          (parent.entityType === 'MODULE' &&
            ['MODULE', 'FEATURE', 'DECISION_RECORD', 'ARTIFACT', 'CODE_REFERENCE'].includes(entity.entityType)) ||
          (parent.entityType === 'FEATURE' && ['WORK_ITEM'].includes(entity.entityType)) ||
          (parent.entityType === 'WORK_ITEM' &&
            entity.entityType === 'WORK_ITEM' &&
            allEntities.find(e => e.id === parent.parentId)?.entityType !== 'WORK_ITEM' &&
            !allEntities.some(e => e.parentId === parent.id && e.entityType === 'WORK_ITEM'));
    if (!valid)
      throw new DomainError(
        'INCOMPATIBLE_PARENT',
        `${capitalize(label(entity.entityType))} «${entity.title}» no puede ir ${parent ? `${withDe('dentro de', label(parent.entityType))} «${parent.title}»` : 'en la raíz sin padre'}.`,
      );
    let cursor = parent;
    const visited = new Set<string>([entity.id]);
    while (cursor) {
      if (visited.has(cursor.id)) throw new DomainError('CYCLE_DETECTED', 'Parent hierarchy would contain a cycle.');
      visited.add(cursor.id);
      cursor = allEntities.find(e => e.id === cursor?.parentId) ?? null;
    }
  }
  validateEdge(
    source: KnowledgeEntity,
    target: KnowledgeEntity,
    type: GraphEdgeType,
    edges: readonly GraphRelationship[],
  ): void {
    if (source.id === target.id) throw new DomainError('SELF_REFERENCE', 'An edge cannot connect an entity to itself.');
    if (source.projectId !== target.projectId)
      throw new DomainError('CROSS_PROJECT_EDGE', 'Both edge endpoints must belong to the same project.');
    if (!EDGE_COMPATIBILITY[type].some(([s, t]) => s === source.entityType && t === target.entityType))
      throw new DomainError('INCOMPATIBLE_EDGE', incompatibleEdgeMessage(type, source, target));
    if (DAG_EDGE_TYPES.has(type)) {
      const adjacency = new Map<string, string[]>();
      for (const edge of edges)
        if (edge.edgeType === type)
          adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) ?? []), edge.targetId]);
      adjacency.set(source.id, [...(adjacency.get(source.id) ?? []), target.id]);
      const visiting = new Set<string>(),
        visited = new Set<string>();
      const visit = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
        visiting.delete(id);
        visited.add(id);
        return false;
      };
      for (const id of adjacency.keys())
        if (visit(id)) throw new DomainError('CYCLE_DETECTED', `${type} relationships must form a DAG.`);
    }
  }
}
export const edgeCompatibilityMatrix = EDGE_COMPATIBILITY;

/** User-facing (Spanish) names of entity and edge types, for validation messages. */
const ENTITY_LABEL: Partial<Record<KnowledgeEntityType, string>> = {
  PROJECT_ROOT: 'el proyecto',
  MODULE: 'el módulo',
  FEATURE: 'la feature',
  REQUIREMENT: 'el requisito',
  WORK_ITEM: 'la tarea',
  DECISION_RECORD: 'la decisión (ADR)',
  ARTIFACT: 'el documento',
  CODE_REFERENCE: 'el archivo de código',
  MILESTONE: 'el hito',
};
const EDGE_LABEL: Record<GraphEdgeType, string> = {
  DEPENDS_ON: 'depende de',
  IMPLEMENTS: 'implementa',
  SATISFIES: 'satisface',
  AFFECTS: 'afecta a',
  SUPERSEDES: 'reemplaza a',
  DOCUMENTED_BY: 'documentado en',
  VERIFIED_BY: 'verificado por',
  TOUCHES_CODE: 'toca el código',
  MODIFIES: 'modifica',
  GENERATED_BY: 'generado por',
  SCOPED_IN: 'en el hito',
};
const label = (type: KnowledgeEntityType) => ENTITY_LABEL[type] ?? type;
const plain = (type: KnowledgeEntityType) => label(type).replace(/^(el|la) /, '');
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Spanish contractions: «de el» → «del», «a el» → «al». */
const withDe = (preposition: string, noun: string) => `${preposition} ${noun}`.replace(/\bde el /, 'del ');
const withA = (noun: string) => `a ${noun}`.replace(/^a el /, 'al ');
function incompatibleEdgeMessage(type: GraphEdgeType, source: KnowledgeEntity, target: KnowledgeEntity): string {
  const allowed = EDGE_COMPATIBILITY[type].map(([from, to]) => `${plain(from)} → ${plain(to)}`).join(', ');
  return `La relación «${EDGE_LABEL[type]}» no puede ir ${withDe('de', label(source.entityType))} «${source.title}» ${withA(label(target.entityType))} «${target.title}». Se permite: ${allowed}.`;
}

/** The edge rules as the planner prompt states them: one clause per edge type the planner may create. */
export function describeEdgeRules(types: readonly GraphEdgeType[]): string {
  return types
    .map(
      type =>
        `${type} from ${[...new Set(EDGE_COMPATIBILITY[type].map(([from]) => from))].join('/')} to ${[...new Set(EDGE_COMPATIBILITY[type].map(([, to]) => to))].join('/')} (allowed pairs: ${EDGE_COMPATIBILITY[type].map(([from, to]) => `${from}→${to}`).join(', ')})`,
    )
    .join('; ');
}
