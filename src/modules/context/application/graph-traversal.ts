import { condenseOutcomeSummary } from '../../execution/index.js';
import type { ContextRepositoryPort } from './ports/context-engine-port.js';
import type { ResolvedContext } from './context-types.js';
import { candidateForRecord } from './context-resolver.js';
import type { GraphRelationship } from '../../knowledge/index.js';
import { addMappedCode, addModifiedCode, isMappedCode } from './code-pointers.js';

export class GraphTraversal {
  constructor(private readonly repository: ContextRepositoryPort) {}
  /** Closing summary of an accepted task, or the summaries of its completed runs for tasks closed before Stage 2. */
  private taskMemory(workItemId: string, distance: number): string {
    const outcome = this.repository.findTaskOutcome(workItemId);
    if (outcome) {
      const commit = outcome.mergedCommit ? `, commit ${outcome.mergedCommit.slice(0, 12)}` : '';
      const files = outcome.files.length
        ? `\n\nArchivos: ${outcome.files.map(file => `${file.path} (${file.status})`).join(', ')}`
        : '';
      const checks = outcome.checks.length
        ? `\nComprobaciones: ${outcome.checks.map(check => `${check.command} ${check.passed ? 'OK' : 'FALLÓ'}`).join(', ')}`
        : '';
      return `\n\nResultado al cerrar la tarea (${outcome.createdAt.slice(0, 10)}${commit}):\n${condenseOutcomeSummary(outcome.summary, distance > 1)}${files}${checks}`;
    }
    const summaries = this.repository.listExecutionSummaries(workItemId);
    return summaries.length
      ? `\n\nResultados de ejecuciones completadas:\n${summaries.map(summary => `- ${summary.completedAt ?? ''}: ${summary.resultSummary ?? 'Sin resumen'}`).join('\n')}`
      : '';
  }
  expand(context: ResolvedContext): ResolvedContext {
    const expansion = new Expansion(context, this.repository, (id, distance) => this.taskMemory(id, distance));
    expansion.followEdges();
    expansion.followDependencies();
    expansion.addFeatureMemory();
    addModifiedCode(context);
    addMappedCode(context);
    expansion.addProjectDocuments();
    return context;
  }
}

type Tier = import('../domain/context-snapshot.js').ContextAuthorityTier;

/** One expansion of a resolved context along the graph around its anchors (the focus, extra focus and ancestors). */
class Expansion {
  private readonly anchorIds: Set<string>;
  private readonly relationships: GraphRelationship[];
  private readonly distanceByEdge: Map<string, number>;

  constructor(
    private readonly context: ResolvedContext,
    repository: ContextRepositoryPort,
    private readonly taskMemory: (workItemId: string, distance: number) => string,
  ) {
    this.anchorIds = new Set([
      context.focus.entity.id,
      ...(context.extraFocus ?? []).map(item => item.entity.id),
      ...context.ancestors.map(item => item.entity.id),
    ]);
    const traversed = repository.traverseGraph(
      context.project.id,
      [...this.anchorIds],
      context.maxHops > 0 ? context.maxHops + 1 : 0,
    );
    this.relationships = traversed.map(item => item.relationship);
    this.distanceByEdge = new Map(traversed.map(item => [item.relationship.id, item.graphDistance]));
  }

  private edgeDistance(edge: GraphRelationship): number {
    return this.distanceByEdge.get(edge.id) ?? 1;
  }

  private add(entityId: string, edge: GraphRelationship, distance: number, tier: Tier = 3): void {
    const record = this.context.entities.get(entityId);
    if (!record) return;
    const candidate = candidateForRecord(record, 'GRAPH_EDGE', distance, tier, 0, edge.edgeType);
    const prior = this.context.candidates.findIndex(item => item.sourceId === entityId);
    if (prior < 0) this.context.candidates.push(candidate);
    else if (this.context.candidates[prior]!.authorityTier > tier) this.context.candidates[prior] = candidate;
  }

  private addDependency(entityId: string, edge: GraphRelationship, distance: number): void {
    const record = this.context.entities.get(entityId);
    if (!record) return;
    const candidate = candidateForRecord(record, 'GRAPH_EDGE', distance, 5, 0, edge.edgeType),
      memory = this.taskMemory(entityId, distance);
    if (memory) candidate.content += memory;
    if (this.context.candidates.findIndex(item => item.sourceId === entityId) < 0)
      this.context.candidates.push(candidate);
  }

  private entityType(id: string): string | undefined {
    return this.context.entities.get(id)?.entity.entityType;
  }

  /** Every edge around the anchors: decisions in scope, documents, requirements, implementations, checks and code. */
  followEdges(): void {
    const { context, anchorIds } = this;
    // Documents the anchors are documented by (e.g. docs/UI_SPEC.md): a decision that AFFECTS one of them applies to them too.
    const documenting = new Set(
      this.relationships
        .filter(edge => edge.edgeType === 'DOCUMENTED_BY' && anchorIds.has(edge.sourceId))
        .map(edge => edge.targetId),
    );
    const scopedAdr = new Map<string, number>();
    for (const edge of this.relationships) {
      if (edge.edgeType === 'AFFECTS' && (anchorIds.has(edge.targetId) || documenting.has(edge.targetId)))
        this.scopeDecision(edge, scopedAdr);
      else this.followEdge(edge);
      if (
        edge.edgeType === 'DEPENDS_ON' &&
        edge.sourceId === context.focus.entity.id &&
        this.entityType(edge.targetId) === 'WORK_ITEM'
      )
        this.addDependency(edge.targetId, edge, this.edgeDistance(edge));
    }
    this.addDecisions(scopedAdr);
  }

  private followEdge(edge: GraphRelationship): void {
    const { context, anchorIds } = this;
    const distance = this.edgeDistance(edge);
    if (edge.edgeType === 'DOCUMENTED_BY' && anchorIds.has(edge.sourceId)) {
      const type = String(context.entities.get(edge.targetId)?.attributes.artifact_type ?? '');
      this.add(edge.targetId, edge, distance, type === 'SPEC' || type === 'IMPLEMENTATION_PLAN' ? 3 : 5);
    }
    if (edge.edgeType === 'SATISFIES' && anchorIds.has(edge.sourceId)) this.add(edge.targetId, edge, distance, 3);
    if (edge.edgeType === 'IMPLEMENTS') {
      if (anchorIds.has(edge.sourceId)) this.add(edge.targetId, edge, distance, 3);
      if (anchorIds.has(edge.targetId) && this.entityType(edge.sourceId) === 'WORK_ITEM')
        this.add(edge.sourceId, edge, distance, 3);
    }
    // Code an anchor touches (the survey's map, plan REP R3) goes as pointers in addMappedCode, not as whole files.
    if (isMappedCode(edge)) return;
    if (edge.edgeType === 'VERIFIED_BY' || edge.edgeType === 'TOUCHES_CODE') {
      if (anchorIds.has(edge.sourceId))
        this.add(edge.targetId, edge, distance, this.entityType(edge.targetId) === 'CODE_REFERENCE' ? 4 : 3);
      if (edge.edgeType === 'VERIFIED_BY' && anchorIds.has(edge.targetId))
        this.add(edge.sourceId, edge, distance, this.entityType(edge.sourceId) === 'CODE_REFERENCE' ? 4 : 3);
    }
  }

  /** An ACCEPTED decision that AFFECTS an anchor is in scope (closest anchor wins); a SUPERSEDED one is excluded. */
  private scopeDecision(edge: GraphRelationship, scopedAdr: Map<string, number>): void {
    const { context, anchorIds } = this;
    const adr = context.entities.get(edge.sourceId);
    if (adr?.entity.entityType !== 'DECISION_RECORD') return;
    if (adr.entity.status === 'ACCEPTED')
      scopedAdr.set(
        edge.sourceId,
        Math.min(
          scopedAdr.get(edge.sourceId) ?? 99,
          anchorIds.has(edge.targetId)
            ? Math.max(
                0,
                [context.focus, ...context.ancestors].findIndex(item => item.entity.id === edge.targetId),
              )
            : 1,
        ),
      );
    else if (adr.entity.status === 'SUPERSEDED')
      context.excluded.push({
        sourceId: edge.sourceId,
        titleOrPath: adr.entity.title,
        authorityTier: 2,
        exclusionReason: 'SUPERSEDED_DECISION',
      });
  }

  /** Decisions in scope enter at tier 2, unless an ACCEPTED decision supersedes them. */
  private addDecisions(scopedAdr: Map<string, number>): void {
    const { context, relationships } = this;
    for (const [adrId, distance] of scopedAdr) {
      const superseded = relationships.some(
        edge =>
          edge.edgeType === 'SUPERSEDES' &&
          edge.targetId === adrId &&
          context.entities.get(edge.sourceId)?.entity.status === 'ACCEPTED',
      );
      if (superseded) {
        context.excluded.push({
          sourceId: adrId,
          titleOrPath: context.entities.get(adrId)!.entity.title,
          authorityTier: 2,
          exclusionReason: 'SUPERSEDED_DECISION',
        });
        continue;
      }
      this.add(adrId, relationships.find(edge => edge.edgeType === 'AFFECTS' && edge.sourceId === adrId)!, distance, 2);
    }
  }

  /** Further prerequisites of the focus (DEPENDS_ON between tasks), up to `maxHops`, with their memory. */
  followDependencies(): void {
    const { context } = this;
    if (context.maxHops <= 1) return;
    let frontier = [context.focus.entity.id, ...(context.extraFocus ?? []).map(item => item.entity.id)];
    const visited = new Set(frontier);
    for (let distance = 1; distance <= context.maxHops; distance++) {
      const next: string[] = [];
      for (const edge of this.relationships) {
        if (edge.edgeType !== 'DEPENDS_ON' || !frontier.includes(edge.sourceId) || visited.has(edge.targetId)) continue;
        if (this.entityType(edge.targetId) !== 'WORK_ITEM') continue;
        visited.add(edge.targetId);
        next.push(edge.targetId);
        this.addDependency(edge.targetId, edge, distance);
      }
      frontier = next;
      if (!frontier.length) break;
    }
  }

  /** Memory that flows (Stage 2): finished tasks of the same feature. */
  addFeatureMemory(): void {
    const { context } = this;
    const parentId = context.focus.entity.parentId;
    if (context.focus.entity.entityType !== 'WORK_ITEM' || !parentId) return;
    for (const record of context.entities.values()) {
      const entity = record.entity;
      if (
        entity.entityType !== 'WORK_ITEM' ||
        entity.id === context.focus.entity.id ||
        entity.parentId !== parentId ||
        entity.status !== 'DONE' ||
        context.candidates.some(candidate => candidate.sourceId === entity.id)
      )
        continue;
      const candidate = candidateForRecord(record, 'GRAPH_EDGE', 2, 5);
      const memory = this.taskMemory(entity.id, 2);
      if (!memory) continue;
      candidate.content += memory;
      context.candidates.push(candidate);
    }
  }

  /** The project's general documents (PRD, architecture, domain, plan) not reached through an edge. */
  addProjectDocuments(): void {
    const { context } = this;
    for (const record of context.entities.values())
      if (
        record.entity.entityType === 'ARTIFACT' &&
        ['PRD', 'ARCHITECTURE', 'DOMAIN_DOC', 'IMPLEMENTATION_PLAN', 'OTHER'].includes(
          String(record.attributes.artifact_type),
        ) &&
        !context.candidates.some(candidate => candidate.sourceId === record.entity.id)
      )
        context.candidates.push(candidateForRecord(record, 'GRAPH_EDGE', 2, 5));
  }
}
