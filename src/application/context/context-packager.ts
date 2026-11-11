import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
import type { ContextRepositoryPort } from '../ports/context-engine-port.js';
import type { ResolvedContext } from './context-types.js';
import type { RankedContext } from './context-ranking.js';
export interface ContextPackage {snapshot:ContextSnapshot;packageText:string;warnings:string[]}
export class ContextPackager {
 constructor(private readonly repository:ContextRepositoryPort){}
 package(context:ResolvedContext,ranked:RankedContext,maxAllowedTokens:number):ContextPackage{
  const snapshot:ContextSnapshot={id:globalThis.crypto.randomUUID(),projectId:context.project.id,executionId:context.executionId??null,focusEntityId:context.focus.entity.id,repositoryCommit:context.repositoryCommit,graphRevision:context.project.currentRevision,createdAt:new Date().toISOString(),tokenUsage:{maxAllowedTokens,totalUsedTokens:ranked.totalUsedTokens},constraints:context.constraints,includedSources:ranked.includedSources,excludedSources:ranked.excludedSources};
  this.repository.persistSnapshot(snapshot);
  // Tiers 1-3 are always included; say so when they alone exceed the budget instead of silently overrunning it.
  const mandatory=ranked.includedSources.filter(source=>source.authorityTier<=3).reduce((total,source)=>total+source.tokenCount,0);
  const warnings=mandatory>maxAllowedTokens?[`Las reglas, decisiones y especificaciones obligatorias suman ~${mandatory.toLocaleString('es')} tokens y superan el presupuesto de ${maxAllowedTokens.toLocaleString('es')}; se incluyen igualmente.`]:[];
  return {snapshot,packageText:renderContextSnapshot(snapshot),warnings};
 }
}
export function renderContextSnapshot(snapshot:ContextSnapshot):string{return [`<ContextSnapshot id="${escapeXml(snapshot.id)}" project="${escapeXml(snapshot.projectId)}" graphRevision="${snapshot.graphRevision}" repositoryCommit="${escapeXml(snapshot.repositoryCommit)}">`,`<Constraints>\n${snapshot.constraints.map(rule=>`- ${escapeXml(rule)}`).join('\n')}\n</Constraints>`,...snapshot.includedSources.map(source=>`<Source id="${escapeXml(source.sourceId)}" tier="${source.authorityTier}" type="${source.sourceType}" hash="${escapeXml(source.contentHash)}" origin="${source.retrievalOrigin}">\n${escapeXml(source.extractedContent)}\n</Source>`),'</ContextSnapshot>'].join('\n\n');}
function escapeXml(value:string):string{return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
