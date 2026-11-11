import { extractConventions } from '../../domain/work-management/task-outcome.js';
import { renderProfileForContext } from '../../domain/projects/project-profile.js';
import type { ContextRepositoryPort,ContextFilePort } from '../ports/context-engine-port.js';
import type { ResolvedContext,ContextCandidate } from './context-types.js';

export class ContextResolver {
 constructor(private readonly repository:ContextRepositoryPort,private readonly files:ContextFilePort){}
 async resolve(input:{projectId:string;focusEntityId:string;extraFocusEntityIds?:string[];query?:string;maxHops?:number;recentNotes?:string[];executionId?:string;sourceCommit?:string}):Promise<ResolvedContext>{
  const project=this.repository.findProjectContext(input.projectId);if(!project)throw new Error('Proyecto no encontrado para resolver el contexto.');
  const entities=new Map(this.repository.listEntities(input.projectId).map(entity=>[entity.id,entity]));const focusEntity=entities.get(input.focusEntityId);if(!focusEntity)throw new Error('La entidad de foco no pertenece al proyecto.');
  const records=new Map<string,import('../ports/context-engine-port.js').ContextEntityRecord>();for(const entity of entities.values()){const record=this.repository.findEntityRecord(entity.id);if(record)records.set(entity.id,record);}
  const focus=records.get(focusEntity.id);if(!focus)throw new Error('No se pudieron cargar los detalles de la entidad seleccionada.');
  const ancestors:ResolvedContext['ancestors']=[],visited=new Set([focus.entity.id]);let parentId=focus.entity.parentId;
  while(parentId){if(visited.has(parentId))throw new Error('La jerarquía del grafo contiene un ciclo.');visited.add(parentId);const parent=records.get(parentId);if(!parent)throw new Error('La jerarquía del foco contiene una entidad padre inexistente.');ancestors.push(parent);parentId=parent.entity.parentId;}
  const candidates:ContextCandidate[]=[];
  // Goal, scope and stack of the project (inception profile): tier 1, a few lines in every run.
  const profile=renderProfileForContext(project);
  if(profile)candidates.push({sourceId:`profile:${project.id}`,entityKey:'PROFILE',sourceType:'POLICY',titleOrPath:'Perfil del proyecto',authorityTier:1,retrievalOrigin:'FOCUS_NODE',graphDistance:0,content:profile,contentHash:this.files.hashContent(profile),relevanceScore:Number.MAX_SAFE_INTEGER});
  for(const [index,rule] of project.rules.entries()){const content=rule.trim();if(!content)continue;candidates.push({sourceId:`policy:${project.id}:${index}`,entityKey:`POLICY-${index+1}`,sourceType:'POLICY',titleOrPath:`Regla del proyecto ${index+1}`,authorityTier:1,retrievalOrigin:'FOCUS_NODE',graphDistance:0,content,contentHash:this.files.hashContent(content),relevanceScore:Number.MAX_SAFE_INTEGER});}
  // Conventions declared by accepted tasks are project rules from then on (tier 1, always included).
  const conventions:string[]=[];
  for(const outcome of this.repository.listTaskOutcomes(input.projectId)){
   const key=entities.get(outcome.workItemId)?.displayKey??'una tarea';
   for(const [index,rule] of extractConventions(outcome.summary).entries()){
    if(conventions.includes(rule))continue;conventions.push(rule);
    candidates.push({sourceId:`convention:${outcome.workItemId}:${index}`,entityKey:`CONV-${key}-${index+1}`,sourceType:'POLICY',titleOrPath:`Convención fijada por ${key}`,authorityTier:1,retrievalOrigin:'FOCUS_NODE',graphDistance:0,content:rule,contentHash:this.files.hashContent(rule),relevanceScore:Number.MAX_SAFE_INTEGER});
   }
  }
  for(const [index,note] of (input.recentNotes??[]).entries()){const content=note.trim();if(!content)continue;candidates.push({sourceId:`chat:${project.id}:${index}`,sourceType:'CHAT_NOTE',titleOrPath:`Nota conversacional ${index+1}`,authorityTier:6,retrievalOrigin:'FULL_TEXT_SEARCH',graphDistance:0,content,contentHash:this.files.hashContent(content),relevanceScore:0});}
  const hierarchy=[focus,...ancestors];for(let i=0;i<hierarchy.length;i++){const record=hierarchy[i]!;candidates.push(candidateForRecord(record,i===0?'FOCUS_NODE':'HIERARCHY_PARENT',i===0?0:i,3,record.entity.id===focus.entity.id?Number.MAX_SAFE_INTEGER:0));}
  // The other tasks of a grouped run count as focus too: always included, at the focus's tier.
  const extraFocus:ResolvedContext['extraFocus']=[];
  for(const id of input.extraFocusEntityIds??[]){if(id===focus.entity.id||extraFocus.some(record=>record.entity.id===id))continue;const record=records.get(id);if(!record)throw new Error('Una de las tareas del grupo no pertenece al proyecto.');extraFocus.push(record);candidates.push(candidateForRecord(record,'FOCUS_NODE',0,3,Number.MAX_SAFE_INTEGER));}
  // An execution's snapshot is pinned to the commit it starts from; a preview (no execution) reflects the user's HEAD.
  const repositoryCommit=input.sourceCommit??(project.repositoryPath?await this.files.getHeadCommit(project.repositoryPath):'UNKNOWN');
  return {project,focus,extraFocus,entities:records,relationships:this.repository.listRelationships(input.projectId),ancestors,constraints:[...project.rules,...conventions],candidates,excluded:[],query:(input.query?.trim()||[focus,...extraFocus].map(record=>`${record.entity.title} ${record.entity.summary}`).join(' ')).trim(),maxHops:Math.max(0,Math.min(2,input.maxHops??1)),repositoryCommit,...(input.sourceCommit?{sourceCommit:input.sourceCommit}:{}),...(input.executionId?{executionId:input.executionId}:{})};
 }
}
export function candidateForRecord(record:import('../ports/context-engine-port.js').ContextEntityRecord,origin:ContextCandidate['retrievalOrigin'],distance:number,tier:ContextCandidate['authorityTier'],relevanceScore=0,viaEdgeType?:ContextCandidate['viaEdgeType']):ContextCandidate{
 const {entity,attributes}=record;const path=typeof attributes.relative_path==='string'?attributes.relative_path:typeof attributes.file_path==='string'?attributes.file_path:undefined;
 const sourceType:ContextCandidate['sourceType']=entity.entityType==='DECISION_RECORD'?'ADR':entity.entityType==='REQUIREMENT'?'REQUIREMENT':entity.entityType==='WORK_ITEM'?'WORK_ITEM':entity.entityType==='CODE_REFERENCE'?'CODE_FILE':entity.entityType==='ARTIFACT'&&['SPEC','IMPLEMENTATION_PLAN'].includes(String(attributes.artifact_type))?'SPECIFICATION':'DOC';
 const acceptedAttributes=Object.fromEntries(Object.entries(attributes).filter(([key,value])=>!['repository_id','content_hash','sync_status','entity_id','entityId'].includes(key)&&value!==null));const details=Object.keys(acceptedAttributes).length?`\n${JSON.stringify(acceptedAttributes)}`:'';
 const content=record.bodyContent.trim()||`${entity.title}\n${entity.summary}${details}`;
 return {sourceId:entity.id,entityKey:entity.displayKey,sourceType,titleOrPath:path??entity.title,authorityTier:tier,retrievalOrigin:origin,...(viaEdgeType?{viaEdgeType}:{}),graphDistance:distance,content,contentHash:'',relevanceScore,record};
}
