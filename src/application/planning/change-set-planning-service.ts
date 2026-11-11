import type { ProjectRepositoryPort } from '../ports/project-repository-port.js';
import type { KnowledgeGraphRepositoryPort } from '../ports/knowledge-graph-repository-port.js';
import type { ChangeSetApplyPort, ChangeSetPlannerPort, ChangeSetRepositoryPort } from '../ports/change-set-planning-port.js';
import type { ChangeSet, ChangeOperation } from '../../domain/knowledge/change-set.js';
import { ChangeSetValidator } from './changeset-validator.js';

export class ChangeSetPlanningService {
 private readonly validator=new ChangeSetValidator();
 constructor(private readonly projects:ProjectRepositoryPort,private readonly graph:KnowledgeGraphRepositoryPort,private readonly changes:ChangeSetRepositoryPort,private readonly planner:ChangeSetPlannerPort,private readonly applier:ChangeSetApplyPort,private readonly repositoryPath:(projectId:string)=>string|null){}
 async propose(projectId:string,prompt:string,focusEntityId?:string,contextPackage?:string,model?:string):Promise<ChangeSet>{
  const project=this.projects.findById(projectId);if(!project)throw new Error('Proyecto no encontrado.');if(!prompt.trim())throw new Error('Escribe qué cambios quieres proponer.');
  const entities=this.graph.listEntities(projectId),draft=await this.planner.propose({prompt:prompt.trim(),...(contextPackage?{contextPackage}:{}),...(model?{model}:{}),project:{name:project.props.name,description:project.props.description??null,rules:project.props.rules??[],revision:project.currentRevision,...(project.props.objectives?.length?{objectives:project.props.objectives}:{}),...(project.props.techStack&&Object.keys(project.props.techStack).length?{techStack:project.props.techStack}:{})},focusEntity:entities.find(e=>e.id===focusEntityId)??null,entities,relationships:this.graph.listRelationships(projectId)});
  const changeSet:ChangeSet={id:globalThis.crypto.randomUUID(),projectId,baseGraphRevision:project.currentRevision,originType:'AI_CHAT',title:draft.title,rationale:draft.rationale,status:'PENDING_APPROVAL',operations:draft.operations,validationIssues:[],createdAt:new Date().toISOString()};
  const validation=this.validator.validate(changeSet,project.currentRevision,entities,this.graph.listRelationships(projectId));const result={...changeSet,status:validation.status,validationIssues:validation.issues};this.changes.save(result);return result;
 }
 /** Stores a plan change proposed by an agent when it closed a task, validated against the current graph; never applies it. */
 submit(projectId:string,draft:{title:string;rationale:string;operations:ChangeOperation[]},originRefId:string,originType:ChangeSet['originType']='AGENT_EXECUTION'):ChangeSet{
  const project=this.projects.findById(projectId);if(!project)throw new Error('Proyecto no encontrado.');
  const changeSet:ChangeSet={id:globalThis.crypto.randomUUID(),projectId,baseGraphRevision:project.currentRevision,originType,originRefId,title:draft.title,rationale:draft.rationale,status:'PENDING_APPROVAL',operations:draft.operations,validationIssues:[],createdAt:new Date().toISOString()};
  const validation=this.validator.validate(changeSet,project.currentRevision,this.graph.listEntities(projectId),this.graph.listRelationships(projectId));const result={...changeSet,status:validation.status,validationIssues:validation.issues};this.changes.save(result);return result;
 }
 edit(id:string,operations:ChangeOperation[]):ChangeSet {
  const current=this.requireChangeSet(id);if(!['PENDING_APPROVAL','CONFLICTED','VALIDATED'].includes(current.status))throw new Error('Esta propuesta ya no se puede editar.');
  const project=this.projects.findById(current.projectId)!;const edited={...current,baseGraphRevision:project.currentRevision,operations,status:'PENDING_APPROVAL' as const,validationIssues:[]};const validation=this.validator.validate(edited,project.currentRevision,this.graph.listEntities(current.projectId),this.graph.listRelationships(current.projectId));const result={...edited,status:validation.status,validationIssues:validation.issues};this.changes.save(result);return result;
 }
 list(projectId:string):ChangeSet[]{return this.changes.list(projectId);}
 find(id:string):ChangeSet|null{return this.changes.findById(id);}
 reject(id:string):ChangeSet {const current=this.requireChangeSet(id);if(['APPLIED','REJECTED'].includes(current.status))throw new Error('La propuesta ya está cerrada.');const result={...current,status:'REJECTED' as const};this.changes.save(result);return result;}
 async apply(id:string):Promise<{changeSet:ChangeSet;revision:number;resolvedIds:Record<string,string>}>{
  const current=this.requireChangeSet(id);if(current.status!=='VALIDATED')throw new Error('Valida la propuesta antes de aplicarla.');const project=this.projects.findById(current.projectId);if(!project)throw new Error('Proyecto no encontrado.');
  const validation=this.validator.validate(current,project.currentRevision,this.graph.listEntities(current.projectId),this.graph.listRelationships(current.projectId));if(!validation.valid){const updated={...current,status:validation.status,validationIssues:validation.issues};this.changes.save(updated);throw new Error('La propuesta entró en conflicto y debe revisarse.');}
  let applied:{revision:number;resolvedIds:Record<string,string>};try{applied=await this.applier.apply(current,this.repositoryPath(current.projectId));}catch(error){if(error instanceof Error&&error.message.includes('REVISION_CONFLICT')){const conflicted={...current,status:'CONFLICTED' as const,validationIssues:[{operationIndex:-1,severity:'ERROR' as const,code:'REVISION_CONFLICT',message:'El grafo cambió mientras se aplicaba la propuesta. Vuelve a generarla o edítala.'}]};this.changes.save(conflicted);}throw error;}const result={...current,status:'APPLIED' as const,appliedGraphRevision:applied.revision,appliedAt:new Date().toISOString()};this.changes.save(result);return {changeSet:result,revision:applied.revision,resolvedIds:applied.resolvedIds};
 }
 private requireChangeSet(id:string):ChangeSet {const found=this.changes.findById(id);if(!found)throw new Error('Propuesta no encontrada.');return found;}
}
