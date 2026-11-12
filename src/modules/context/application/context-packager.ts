import type { ContextSnapshot } from '../domain/context-snapshot.js';
import type { ContextRepositoryPort } from './ports/context-engine-port.js';
import type { ResolvedContext } from './context-types.js';
import type { RankedContext } from './context-ranking.js';
export interface ContextPackage {
  snapshot: ContextSnapshot;
  packageText: string;
  warnings: string[];
}
export class ContextPackager {
  constructor(private readonly repository: ContextRepositoryPort) {}
  package(context: ResolvedContext, ranked: RankedContext, maxAllowedTokens: number): ContextPackage {
    const snapshot: ContextSnapshot = {
      id: globalThis.crypto.randomUUID(),
      projectId: context.project.id,
      executionId: context.executionId ?? null,
      focusEntityId: context.focus.entity.id,
      repositoryCommit: context.repositoryCommit,
      graphRevision: context.project.currentRevision,
      createdAt: new Date().toISOString(),
      tokenUsage: { maxAllowedTokens, totalUsedTokens: ranked.totalUsedTokens },
      constraints: context.constraints,
      includedSources: ranked.includedSources,
      excludedSources: ranked.excludedSources,
    };
    this.repository.persistSnapshot(snapshot);
    // Tiers 1-3 are always included; say so when they alone exceed the budget instead of silently overrunning it.
    const mandatory = ranked.includedSources
      .filter(source => source.authorityTier <= 3)
      .reduce((total, source) => total + source.tokenCount, 0);
    const warnings =
      mandatory > maxAllowedTokens
        ? [
            `Las reglas, decisiones y especificaciones obligatorias suman ~${mandatory.toLocaleString('es')} tokens y superan el presupuesto de ${maxAllowedTokens.toLocaleString('es')}; se incluyen igualmente.`,
          ]
        : [];
    return { snapshot, packageText: renderContextSnapshot(snapshot), warnings };
  }
}
/**
 * Text sent to the model. The snapshot keeps everything (ids, hashes, every source) in SQLite for audit; the text drops what
 * the model cannot use: project rules and learned conventions already appear in <Constraints>, so their tier-1 sources are not
 * repeated, and each <Source> is named by its readable key (TASK-002, ADR-001) instead of a UUID, without the content hash.
 */
export function renderContextSnapshot(snapshot: ContextSnapshot): string {
  return [
    `<ContextSnapshot id="${escapeXml(snapshot.id)}" project="${escapeXml(snapshot.projectId)}" graphRevision="${snapshot.graphRevision}" repositoryCommit="${escapeXml(snapshot.repositoryCommit)}">`,
    `<Constraints>\n${snapshot.constraints.map(rule => `- ${escapeXml(rule)}`).join('\n')}\n</Constraints>`,
    ...snapshot.includedSources
      .filter(source => !isRepeatedRule(source))
      .map(
        source =>
          `<Source id="${escapeXml(source.entityKey ?? source.titleOrPath)}" tier="${source.authorityTier}" type="${source.sourceType}" origin="${source.retrievalOrigin}">\n${escapeXml(source.extractedContent)}\n</Source>`,
      ),
    '</ContextSnapshot>',
  ].join('\n\n');
}
function isRepeatedRule(source: { sourceType: string; sourceId: string }): boolean {
  return (
    source.sourceType === 'POLICY' &&
    (source.sourceId.startsWith('policy:') || source.sourceId.startsWith('convention:'))
  );
}
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
