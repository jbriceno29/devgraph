import type { ContextCandidate } from './context-types.js';
import type { ContextSourceEntry, ExcludedSourceEntry } from '../../domain/knowledge/context-snapshot.js';
export interface RankedContext {
  includedSources: ContextSourceEntry[];
  excludedSources: ExcludedSourceEntry[];
  totalUsedTokens: number;
}
export class ContextRanking {
  rank(
    candidates: ContextCandidate[],
    initiallyExcluded: ExcludedSourceEntry[],
    maxAllowedTokens: number,
  ): RankedContext {
    const unique = new Map<string, ContextCandidate>();
    for (const candidate of candidates) {
      const current = unique.get(candidate.sourceId);
      if (
        !current ||
        candidate.authorityTier < current.authorityTier ||
        (candidate.authorityTier === current.authorityTier && candidate.relevanceScore > current.relevanceScore)
      )
        unique.set(candidate.sourceId, candidate);
    }
    const ordered = [...unique.values()].sort(
      (a, b) =>
        a.authorityTier - b.authorityTier ||
        a.graphDistance - b.graphDistance ||
        b.relevanceScore - a.relevanceScore ||
        a.titleOrPath.localeCompare(b.titleOrPath),
    );
    let used = 0;
    const includedSources: ContextSourceEntry[] = [],
      excludedSources = [...initiallyExcluded];
    for (const candidate of ordered) {
      const tokenCount = estimateTokens(candidate.content),
        entry: ContextSourceEntry = {
          sourceId: candidate.sourceId,
          ...(candidate.entityKey ? { entityKey: candidate.entityKey } : {}),
          sourceType: candidate.sourceType,
          titleOrPath: candidate.titleOrPath,
          authorityTier: candidate.authorityTier,
          retrievalOrigin: candidate.retrievalOrigin,
          ...(candidate.viaEdgeType ? { viaEdgeType: candidate.viaEdgeType } : {}),
          graphDistance: candidate.graphDistance,
          contentHash: candidate.contentHash,
          extractedContent: candidate.content,
          tokenCount,
        };
      if (candidate.authorityTier <= 3 || used + tokenCount <= maxAllowedTokens) {
        includedSources.push(entry);
        used += tokenCount;
      } else
        excludedSources.push({
          sourceId: candidate.sourceId,
          titleOrPath: candidate.titleOrPath,
          authorityTier: candidate.authorityTier,
          exclusionReason: 'TOKEN_BUDGET_EXCEEDED',
        });
    }
    return { includedSources, excludedSources: dedupeExcluded(excludedSources), totalUsedTokens: used };
  }
}
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}
function dedupeExcluded(entries: ExcludedSourceEntry[]): ExcludedSourceEntry[] {
  const seen = new Set<string>();
  return entries.filter(item => {
    if (seen.has(item.sourceId)) return false;
    seen.add(item.sourceId);
    return true;
  });
}
