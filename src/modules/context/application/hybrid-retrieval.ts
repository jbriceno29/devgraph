import type { ContextRepositoryPort, ContextFilePort } from './ports/context-engine-port.js';
import type { ContextCandidate, ResolvedContext } from './context-types.js';
import { candidateForRecord } from './context-resolver.js';

export class HybridRetrieval {
  constructor(
    private readonly repository: ContextRepositoryPort,
    private readonly files: ContextFilePort,
  ) {}
  async enrich(context: ResolvedContext): Promise<ResolvedContext> {
    this.addSearchHits(context);
    for (let i = context.candidates.length - 1; i >= 0; i--)
      if (!(await this.loadContent(context, context.candidates[i]!))) {
        context.excluded.push(excluded(context.candidates[i]!));
        context.candidates.splice(i, 1);
      }
    for (const candidate of context.candidates)
      if (!candidate.contentHash) candidate.contentHash = this.files.hashContent(candidate.content);
    return context;
  }

  /**
   * Full-text hits not already in. Code references come through MODIFIES edges (graph traversal), not text search: a
   * match by file name says nothing about relevance. Unfinished work items are future work, not knowledge: their specs
   * only distract (seen in the second benchmark).
   */
  private addSearchHits(context: ResolvedContext): void {
    for (const hit of this.repository.search(context.project.id, context.query, 20)) {
      const record = hit.record;
      if (
        record.entity.entityType === 'DECISION_RECORD' ||
        record.entity.entityType === 'CODE_REFERENCE' ||
        (record.entity.entityType === 'WORK_ITEM' && record.entity.status !== 'DONE') ||
        context.candidates.some(candidate => candidate.sourceId === record.entity.id)
      )
        continue;
      const tier: ContextCandidate['authorityTier'] =
        record.entity.entityType === 'REQUIREMENT'
          ? 3
          : record.entity.entityType === 'ARTIFACT' &&
              ['SPEC', 'IMPLEMENTATION_PLAN'].includes(String(record.attributes.artifact_type))
            ? 3
            : 5;
      context.candidates.push(candidateForRecord(record, 'FULL_TEXT_SEARCH', 3, tier, hit.relevanceScore));
    }
  }

  /** Reads a candidate's file from the repository (at the run's commit); false when it cannot be verified. */
  private async loadContent(context: ResolvedContext, candidate: ContextCandidate): Promise<boolean> {
    const record = candidate.record;
    if (!record) return true;
    const { entity, attributes } = record;
    const path = entity.entityType === 'CODE_REFERENCE' ? attributes.file_path : attributes.relative_path;
    // Code a previous task modified, or that the map places under an anchor (plan REP, R3), is passed as a pointer: it lives on the integration branch the agent works on,
    // not necessarily in the user's checkout, and the agent can read it in its worktree. This keeps the context lean.
    if (entity.entityType === 'CODE_REFERENCE' && (candidate.viaEdgeType === 'MODIFIES' || candidate.pointer)) {
      candidate.contentHash = this.files.hashContent(candidate.content);
      return true;
    }
    if (typeof path !== 'string' || !['ARTIFACT', 'DECISION_RECORD', 'CODE_REFERENCE'].includes(entity.entityType)) {
      candidate.contentHash = this.files.hashContent(candidate.content);
      return true;
    }
    if (!context.project.repositoryPath) return false;
    try {
      const file = await this.files.readRepositoryFile(context.project.repositoryPath, path, context.sourceCommit);
      if (entity.entityType === 'CODE_REFERENCE') {
        const start = typeof attributes.line_start === 'number' ? Math.max(1, attributes.line_start) : 1,
          end =
            typeof attributes.line_end === 'number'
              ? Math.max(start, attributes.line_end)
              : file.content.split('\n').length;
        candidate.content = file.content
          .split('\n')
          .slice(start - 1, end)
          .join('\n');
        candidate.contentHash = this.files.hashContent(candidate.content);
      } else {
        const previousHash = typeof attributes.content_hash === 'string' ? attributes.content_hash : '';
        if (!context.sourceCommit && previousHash && previousHash !== file.contentHash)
          this.repository.updateArtifactDrift(entity.id, file.contentHash, file.content);
        candidate.content = file.content;
        candidate.contentHash = file.contentHash;
      }
      candidate.titleOrPath = path;
      return true;
    } catch {
      return false;
    }
  }
}

function excluded(candidate: ContextCandidate) {
  return {
    sourceId: candidate.sourceId,
    titleOrPath: candidate.titleOrPath,
    authorityTier: candidate.authorityTier,
    exclusionReason: 'DRIFTED_UNVERIFIED' as const,
  };
}
