import { GraphTopologyService } from '../../domain/graph/graph-topology-service.js';
import type { ChangeOperation, ChangeSet } from '../../domain/knowledge/change-set.js';
import type { GraphRelationship, KnowledgeEntity } from '../../domain/graph/knowledge-entity.js';
import { canTransitionWorkItem } from '../../domain/work-management/entities.js';
import { profileIssues } from '../../domain/projects/project-profile.js';
import { UI_SPEC_PATH } from '../../shared/ui-spec.js';
import { missingUiSpecSections } from './ui-spec-update.js';

export interface ValidationResult { valid:boolean; issues:ChangeSet['validationIssues']; status:'VALIDATED'|'CONFLICTED'|'PENDING_APPROVAL' }
const docOps=(operation:ChangeOperation)=>operation.type==='UPSERT_ARTIFACT'||operation.type==='CREATE_DECISION_RECORD';
const createsEntity=(operation:ChangeOperation)=>['CREATE_MODULE','CREATE_FEATURE','CREATE_REQUIREMENT','CREATE_WORK_ITEM','CREATE_DECISION_RECORD'].includes(operation.type)||operation.type==='UPSERT_ARTIFACT';
export class ChangeSetValidator {
 validate(changeSet:ChangeSet,currentRevision:number,entities:KnowledgeEntity[],relationships:GraphRelationship[]):ValidationResult {
  const issues:ChangeSet['validationIssues']=[];
  if(changeSet.baseGraphRevision!==currentRevision)issues.push({operationIndex:-1,severity:'ERROR',code:'REVISION_CONFLICT',message:`La propuesta parte de la revisión ${changeSet.baseGraphRevision}; la revisión actual es ${currentRevision}.`});
  if(!changeSet.operations.length)issues.push({operationIndex:-1,severity:'ERROR',code:'EMPTY_CHANGESET',message:'La propuesta no contiene operaciones.'});
  const all=[...entities],edges=[...relationships],tempIds=new Set<string>(),paths=new Set<string>();
  const entityFor=(id:string):KnowledgeEntity|undefined=>all.find(entity=>entity.id===id);
  const topo=new GraphTopologyService();
  for(let i=0;i<changeSet.operations.length;i++){
   const op=changeSet.operations[i]!;if(!createsEntity(op)||op.type==='UPSERT_ARTIFACT'&&op.entityId&&!op.tempId)continue;
   const type=op.type==='CREATE_MODULE'?'MODULE':op.type==='CREATE_FEATURE'?'FEATURE':op.type==='CREATE_REQUIREMENT'?'REQUIREMENT':op.type==='CREATE_WORK_ITEM'?'WORK_ITEM':op.type==='CREATE_DECISION_RECORD'?'DECISION_RECORD':'ARTIFACT';
   const id='tempId'in op&&op.tempId?op.tempId:`$artifact_${i}`,parentId='moduleId'in op?op.moduleId:'parentId'in op?op.parentId??null:null;
   all.push({id,projectId:changeSet.projectId,entityType:type,displayKey:`TMP-${i+1}`,title:'title'in op?op.title:'',summary:'summary'in op?op.summary:'',status:'DRAFT',parentId,createdRevision:currentRevision+1,updatedRevision:currentRevision+1,createdAt:changeSet.createdAt,updatedAt:changeSet.createdAt});
  }
  const plannedIds=new Set(all.slice(entities.length).map(entity=>entity.id));
  for(let i=0;i<changeSet.operations.length;i++){
   const op=changeSet.operations[i]!;const issue=(code:string,message:string)=>issues.push({operationIndex:i,severity:'ERROR',code,message});
    if('tempId'in op&&op.tempId){if(!/^\$[A-Za-z0-9_-]+$/.test(op.tempId)||tempIds.has(op.tempId))issue('INVALID_TEMP_ID',`Identificador temporal inválido o duplicado: ${op.tempId}`);tempIds.add(op.tempId);}
   if(docOps(op)){
    const path=op.relativePath;
    if(!path.startsWith('docs/')||!path.toLowerCase().endsWith('.md')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'||!p))issue('UNSAFE_DOCUMENT_PATH','Los documentos deben usar una ruta relativa segura dentro de docs/ y terminar en .md.');
    if(paths.has(path))issue('DUPLICATE_DOCUMENT_PATH',`La ruta ${path} aparece más de una vez.`);paths.add(path);
    // The interface specification every feature follows can be updated, never broken: whoever writes it (planner, agent, inception, a manual edit) keeps its eight sections.
    if(op.type==='UPSERT_ARTIFACT'&&path===UI_SPEC_PATH){const missing=missingUiSpecSections(op.markdownContent);if(missing.length)issue('UI_SPEC_SECTIONS',`${UI_SPEC_PATH} debe conservar sus 8 secciones; faltan: ${missing.join(', ')}.`);}
   }
   if(op.type==='UPSERT_ARTIFACT'&&op.entityId&&!op.tempId){const entity=entityFor(op.entityId);if(!entity||entity.entityType!=='ARTIFACT'||entity.projectId!==changeSet.projectId)issue('INVALID_ARTIFACT_TARGET','El upsert debe apuntar a un Artifact existente del proyecto.');}
   else if(createsEntity(op)){
    const id='tempId'in op&&op.tempId?op.tempId:`$artifact_${i}`,entity=entityFor(id)!;const parentId=entity.parentId;
    const parent=parentId?entityFor(parentId)??null:null;
    if(parentId?.startsWith('$')&&!plannedIds.has(parentId))issue('MISSING_TEMP_REFERENCE',`No existe la referencia temporal ${parentId}.`);
    try{topo.validateParent(entity,parent,all);}catch(error){issue('INVALID_PARENT',error instanceof Error?error.message:String(error));}
   } else if(op.type==='CREATE_RELATIONSHIP'){
    const source=entityFor(op.sourceId),target=entityFor(op.targetId);
    if(!source||!target)issue('MISSING_ENDPOINT',`No existe un extremo de la relación (${op.sourceId} → ${op.targetId}).`);
    else try{topo.validateEdge(source,target,op.edgeType,edges);}catch(error){issue('INVALID_RELATIONSHIP',error instanceof Error?error.message:String(error));}
    if(source&&target)edges.push({id:`$edge_${i}`,projectId:changeSet.projectId,sourceId:source.id,targetId:target.id,edgeType:op.edgeType,provenance:'CHANGESET',changeSetId:changeSet.id,createdRevision:currentRevision+1,createdAt:changeSet.createdAt});
   } else if(op.type==='UPDATE_ENTITY_STATUS'){
    const entity=entityFor(op.entityId);if(!entity)issue('MISSING_ENTITY',`No existe la entidad ${op.entityId}.`);
    else if(entity.entityType==='WORK_ITEM'&&(!['DRAFT','READY','BLOCKED','IN_PROGRESS','IN_REVIEW','DONE','ARCHIVED'].includes(op.newStatus)||!canTransitionWorkItem(entity.status as import('../../domain/work-management/entities.js').WorkItemStatus,op.newStatus as import('../../domain/work-management/entities.js').WorkItemStatus)))issue('INVALID_STATUS_TRANSITION',`No se permite cambiar el WorkItem de ${entity.status} a ${op.newStatus}.`);
   }
   else if(op.type==='DELETE_RELATIONSHIP'&&!edges.some(edge=>edge.id===op.edgeId))issue('MISSING_RELATIONSHIP',`No existe la relación ${op.edgeId}.`);
   else if(op.type==='SET_PROJECT_PROFILE'){
    if(changeSet.operations.filter(item=>item.type==='SET_PROJECT_PROFILE').length>1&&changeSet.operations.findIndex(item=>item.type==='SET_PROJECT_PROFILE')!==i)issue('DUPLICATE_PROFILE','La propuesta solo puede fijar el perfil del proyecto una vez.');
    for(const message of profileIssues(op))issue('INVALID_PROJECT_PROFILE',message);
   }
  }
  const conflict=issues.some(item=>item.code==='REVISION_CONFLICT');
  return {valid:issues.length===0,issues,status:conflict?'CONFLICTED':issues.length?'PENDING_APPROVAL':'VALIDATED'};
 }
}
