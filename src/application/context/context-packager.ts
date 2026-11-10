import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
import type { ContextRepositoryPort } from '../ports/context-engine-port.js';
import type { ResolvedContext } from './context-types.js';
import type { RankedContext } from './context-ranking.js';
export interface ContextPackage {snapshot:ContextSnapshot;packageText:string}
export class ContextPackager {
 constructor(private readonly repository:ContextRepositoryPort){}
 package(context:ResolvedContext,ranked:RankedContext,maxAllowedTokens:number):ContextPackage{
  const snapshot:ContextSnapshot={id:globalThis.crypto.randomUUID(),projectId:context.project.id,executionId:context.executionId??null,focusEntityId:context.focus.entity.id,repositoryCommit:context.repositoryCommit,graphRevision:context.project.currentRevision,createdAt:new Date().toISOString(),tokenUsage:{maxAllowedTokens,totalUsedTokens:ranked.totalUsedTokens},constraints:context.constraints,includedSources:ranked.includedSources,excludedSources:ranked.excludedSources};
  this.repository.persistSnapshot(snapshot);return {snapshot,packageText:renderContextSnapshot(snapshot)};
 }
}
export function renderContextSnapshot(snapshot:ContextSnapshot):string{return [`<ContextSnapshot id="${escapeXml(snapshot.id)}" project="${escapeXml(snapshot.projectId)}" graphRevision="${snapshot.graphRevision}" repositoryCommit="${escapeXml(snapshot.repositoryCommit)}">`,`<Constraints>\n${snapshot.constraints.map(rule=>`- ${escapeXml(rule)}`).join('\n')}\n</Constraints>`,...snapshot.includedSources.map(source=>`<Source id="${escapeXml(source.sourceId)}" tier="${source.authorityTier}" type="${source.sourceType}" hash="${escapeXml(source.contentHash)}" origin="${source.retrievalOrigin}">\n${escapeXml(source.extractedContent)}\n</Source>`),'</ContextSnapshot>'].join('\n\n');}
function escapeXml(value:string):string{return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
