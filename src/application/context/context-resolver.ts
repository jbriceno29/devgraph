import type { ContextRepositoryPort,ContextFilePort } from '../ports/context-engine-port.js';
import type { ResolvedContext,ContextCandidate } from './context-types.js';

export class ContextResolver {
 constructor(private readonly repository:ContextRepositoryPort,private readonly files:ContextFilePort){}
 async resolve(input:{projectId:string;focusEntityId:string;query?:string;maxHops?:number;recentNotes?:string[]}):Promise<ResolvedContext>{
  const project=this.repository.findProjectContext(input.projectId);if(!project)throw new Error('Proyecto no encontrado para resolver el contexto.');
  const entities=new Map(this.repository.listEntities(input.projectId).map(entity=>[entity.id,entity]));const focusEntity=entities.get(input.focusEntityId);if(!focusEntity)throw new Error('La entidad de foco no pertenece al proyecto.');
  const records=new Map<string,import('../ports/context-engine-port.js').ContextEntityRecord>();for(const entity of entities.values()){const record=this.repository.findEntityRecord(entity.id);if(record)records.set(entity.id,record);}
  const focus=records.get(focusEntity.id);if(!focus)throw new Error('No se pudieron cargar los detalles de la entidad seleccionada.');
  const ancestors:ResolvedContext['ancestors']=[],visited=new Set([focus.entity.id]);let parentId=focus.entity.parentId;
  while(parentId){if(visited.has(parentId))throw new Error('La jerarquía del grafo contiene un ciclo.');visited.add(parentId);const parent=records.get(parentId);if(!parent)throw new Error('La jerarquía del foco contiene una entidad padre inexistente.');ancestors.push(parent);parentId=parent.entity.parentId;}
  const candidates:ContextCandidate[]=[];
  for(const [index,rule] of project.rules.entries()){const content=rule.trim();if(!content)continue;candidates.push({sourceId:`policy:${project.id}:${index}`,entityKey:`POLICY-${index+1}`,sourceType:'POLICY',titleOrPath:`Regla del proyecto ${index+1}`,authorityTier:1,retrievalOrigin:'FOCUS_NODE',graphDistance:0,content,contentHash:this.files.hashContent(content),relevanceScore:Number.MAX_SAFE_INTEGER});}
  for(const [index,note] of (input.recentNotes??[]).entries()){const content=note.trim();if(!content)continue;candidates.push({sourceId:`chat:${project.id}:${index}`,sourceType:'CHAT_NOTE',titleOrPath:`Nota conversacional ${index+1}`,authorityTier:6,retrievalOrigin:'FULL_TEXT_SEARCH',graphDistance:0,content,contentHash:this.files.hashContent(content),relevanceScore:0});}
  const hierarchy=[focus,...ancestors];for(let i=0;i<hierarchy.length;i++){const record=hierarchy[i]!;candidates.push(candidateForRecord(record,i===0?'FOCUS_NODE':'HIERARCHY_PARENT',i===0?0:i,3,record.entity.id===focus.entity.id?Number.MAX_SAFE_INTEGER:0));}
  const repositoryCommit=project.repositoryPath?await this.files.getHeadCommit(project.repositoryPath):'UNKNOWN';
  return {project,focus,entities:records,relationships:this.repository.listRelationships(input.projectId),ancestors,constraints:[...project.rules],candidates,excluded:[],query:(input.query?.trim()||`${focus.entity.title} ${focus.entity.summary}`).trim(),maxHops:Math.max(0,Math.min(2,input.maxHops??1)),repositoryCommit};
 }
}
export function candidateForRecord(record:import('../ports/context-engine-port.js').ContextEntityRecord,origin:ContextCandidate['retrievalOrigin'],distance:number,tier:ContextCandidate['authorityTier'],relevanceScore=0,viaEdgeType?:ContextCandidate['viaEdgeType']):ContextCandidate{
 const {entity,attributes}=record;const path=typeof attributes.relative_path==='string'?attributes.relative_path:typeof attributes.file_path==='string'?attributes.file_path:undefined;
 const sourceType:ContextCandidate['sourceType']=entity.entityType==='DECISION_RECORD'?'ADR':entity.entityType==='REQUIREMENT'?'REQUIREMENT':entity.entityType==='WORK_ITEM'?'WORK_ITEM':entity.entityType==='CODE_REFERENCE'?'CODE_FILE':entity.entityType==='ARTIFACT'&&['SPEC','IMPLEMENTATION_PLAN'].includes(String(attributes.artifact_type))?'SPECIFICATION':'DOC';
 const acceptedAttributes=Object.fromEntries(Object.entries(attributes).filter(([key,value])=>!['repository_id','content_hash','sync_status','entity_id','entityId'].includes(key)&&value!==null));const details=Object.keys(acceptedAttributes).length?`\n${JSON.stringify(acceptedAttributes)}`:'';
 const content=record.bodyContent.trim()||`${entity.title}\n${entity.summary}${details}`;
 return {sourceId:entity.id,entityKey:entity.displayKey,sourceType,titleOrPath:path??entity.title,authorityTier:tier,retrievalOrigin:origin,...(viaEdgeType?{viaEdgeType}:{}),graphDistance:distance,content,contentHash:'',relevanceScore,record};
}
