import type { ContextRepositoryPort } from '../ports/context-engine-port.js';
import type { ResolvedContext } from './context-types.js';
import { candidateForRecord } from './context-resolver.js';
import type { GraphRelationship } from '../../domain/graph/knowledge-entity.js';

export class GraphTraversal {
 constructor(private readonly repository:ContextRepositoryPort){}
 expand(context:ResolvedContext):ResolvedContext{
  const anchorIds=new Set([context.focus.entity.id,...context.ancestors.map(item=>item.entity.id)]),traversed=this.repository.traverseGraph(context.project.id,[...anchorIds],context.maxHops>0?context.maxHops+1:0),relationships=traversed.map(item=>item.relationship),distanceByEdge=new Map(traversed.map(item=>[item.relationship.id,item.graphDistance])),scopedAdr=new Map<string,number>(),edgeDistance=(edge:GraphRelationship)=>distanceByEdge.get(edge.id)??1,add=(entityId:string,edge:GraphRelationship,distance:number,tier:import('../../domain/knowledge/context-snapshot.js').ContextAuthorityTier=3)=>{const record=context.entities.get(entityId);if(!record)return;const candidate=candidateForRecord(record,'GRAPH_EDGE',distance,tier,0,edge.edgeType);const prior=context.candidates.findIndex(item=>item.sourceId===entityId);if(prior<0)context.candidates.push(candidate);else if(context.candidates[prior]!.authorityTier>tier)context.candidates[prior]=candidate;},addDependency=(entityId:string,edge:GraphRelationship,distance:number)=>{const record=context.entities.get(entityId);if(!record)return;const candidate=candidateForRecord(record,'GRAPH_EDGE',distance,5,0,edge.edgeType),summaries=this.repository.listExecutionSummaries(entityId);if(summaries.length)candidate.content+=`\n\nResultados de tareas completadas:\n${summaries.map(summary=>`- ${summary.completedAt??''}: ${summary.resultSummary??'Sin resumen'}`).join('\n')}`;const prior=context.candidates.findIndex(item=>item.sourceId===entityId);if(prior<0)context.candidates.push(candidate);};
  for(const edge of relationships){if(edge.edgeType==='AFFECTS'&&anchorIds.has(edge.targetId)){const adr=context.entities.get(edge.sourceId);if(adr?.entity.entityType==='DECISION_RECORD'){if(adr.entity.status==='ACCEPTED')scopedAdr.set(edge.sourceId,Math.min(scopedAdr.get(edge.sourceId)??99,anchorIds.has(edge.targetId)?Math.max(0,[context.focus,...context.ancestors].findIndex(item=>item.entity.id===edge.targetId)):1));else if(adr.entity.status==='SUPERSEDED')context.excluded.push({sourceId:edge.sourceId,titleOrPath:adr.entity.title,authorityTier:2,exclusionReason:'SUPERSEDED_DECISION'});}}
   if(edge.edgeType==='DOCUMENTED_BY'&&anchorIds.has(edge.sourceId)){const artifact=context.entities.get(edge.targetId);const type=String(artifact?.attributes.artifact_type??'');add(edge.targetId,edge,edgeDistance(edge),type==='SPEC'||type==='IMPLEMENTATION_PLAN'?3:5);}
   if(edge.edgeType==='SATISFIES'&&anchorIds.has(edge.sourceId))add(edge.targetId,edge,edgeDistance(edge),3);
   if(edge.edgeType==='IMPLEMENTS'){
    if(anchorIds.has(edge.sourceId))add(edge.targetId,edge,edgeDistance(edge),3);
    if(anchorIds.has(edge.targetId)&&context.entities.get(edge.sourceId)?.entity.entityType==='WORK_ITEM')add(edge.sourceId,edge,edgeDistance(edge),3);
   }
   if(edge.edgeType==='VERIFIED_BY'||edge.edgeType==='TOUCHES_CODE'){
    if(anchorIds.has(edge.sourceId)){const target=context.entities.get(edge.targetId);add(edge.targetId,edge,edgeDistance(edge),target?.entity.entityType==='CODE_REFERENCE'?4:3);}
    if(edge.edgeType==='VERIFIED_BY'&&anchorIds.has(edge.targetId)){const source=context.entities.get(edge.sourceId);add(edge.sourceId,edge,edgeDistance(edge),source?.entity.entityType==='CODE_REFERENCE'?4:3);}
   }
   if(edge.edgeType==='DEPENDS_ON'&&edge.sourceId===context.focus.entity.id&&context.entities.get(edge.targetId)?.entity.entityType==='WORK_ITEM')addDependency(edge.targetId,edge,edgeDistance(edge));
  }
  for(const [adrId,distance] of scopedAdr){const superseded=relationships.some(edge=>edge.edgeType==='SUPERSEDES'&&edge.targetId===adrId&&context.entities.get(edge.sourceId)?.entity.status==='ACCEPTED');if(superseded){const adr=context.entities.get(adrId)!;context.excluded.push({sourceId:adrId,titleOrPath:adr.entity.title,authorityTier:2,exclusionReason:'SUPERSEDED_DECISION'});continue;}add(adrId,relationships.find(edge=>edge.edgeType==='AFFECTS'&&edge.sourceId===adrId)!,distance,2);}
  if(context.maxHops>1){let frontier=[context.focus.entity.id];const visited=new Set(frontier);for(let distance=1;distance<=context.maxHops;distance++){const next:string[]=[];for(const edge of relationships){if(edge.edgeType!=='DEPENDS_ON'||!frontier.includes(edge.sourceId)||visited.has(edge.targetId))continue;const dependency=context.entities.get(edge.targetId);if(!dependency||dependency.entity.entityType!=='WORK_ITEM')continue;visited.add(edge.targetId);next.push(edge.targetId);addDependency(edge.targetId,edge,distance);}frontier=next;if(!frontier.length)break;}}
  for(const record of context.entities.values())if(record.entity.entityType==='ARTIFACT'&&['PRD','ARCHITECTURE','DOMAIN_DOC','IMPLEMENTATION_PLAN','OTHER'].includes(String(record.attributes.artifact_type))&&!context.candidates.some(candidate=>candidate.sourceId===record.entity.id)){context.candidates.push(candidateForRecord(record,'GRAPH_EDGE',2,5));}
  return context;
 }
}
