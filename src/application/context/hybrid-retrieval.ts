import type { ContextRepositoryPort, ContextFilePort } from '../ports/context-engine-port.js';
import type { ContextCandidate, ResolvedContext } from './context-types.js';
import { candidateForRecord } from './context-resolver.js';

export class HybridRetrieval {
  constructor(
    private readonly repository: ContextRepositoryPort,
    private readonly files: ContextFilePort,
  ) {}
  async enrich(context: ResolvedContext): Promise<ResolvedContext> {
    // Code references come through MODIFIES edges (graph traversal), not text search: a match by file name says nothing about relevance.
    // Unfinished work items are future work, not knowledge: their specs only distract (seen in the second benchmark).
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
    for (let i = context.candidates.length - 1; i >= 0; i--) {
      const candidate = context.candidates[i]!,
        record = candidate.record;
      if (!record) continue;
      const { entity, attributes } = record;
      const path = entity.entityType === 'CODE_REFERENCE' ? attributes.file_path : attributes.relative_path;
      // Code a previous task modified is passed as a pointer: it lives on the integration branch the agent works on,
      // not necessarily in the user's checkout, and the agent can read it in its worktree. This keeps the context lean.
      if (entity.entityType === 'CODE_REFERENCE' && candidate.viaEdgeType === 'MODIFIES') {
        candidate.contentHash = this.files.hashContent(candidate.content);
        continue;
      }
      if (typeof path === 'string' && ['ARTIFACT', 'DECISION_RECORD', 'CODE_REFERENCE'].includes(entity.entityType)) {
        if (!context.project.repositoryPath) {
          context.excluded.push(excluded(candidate));
          context.candidates.splice(i, 1);
          continue;
        }
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
            candidate.titleOrPath = path;
            candidate.contentHash = this.files.hashContent(candidate.content);
          } else {
            const previousHash = typeof attributes.content_hash === 'string' ? attributes.content_hash : '';
            if (!context.sourceCommit && previousHash && previousHash !== file.contentHash)
              this.repository.updateArtifactDrift(entity.id, file.contentHash, file.content);
            candidate.content = file.content;
            candidate.contentHash = file.contentHash;
            candidate.titleOrPath = path;
          }
        } catch {
          context.excluded.push(excluded(candidate));
          context.candidates.splice(i, 1);
          continue;
        }
      } else candidate.contentHash = this.files.hashContent(candidate.content);
    }
    for (const candidate of context.candidates)
      if (!candidate.contentHash) candidate.contentHash = this.files.hashContent(candidate.content);
    return context;
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
