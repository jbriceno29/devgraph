import { createHash,randomUUID } from 'node:crypto';
import type { ChangeOperation,ChangeSet } from '../../../domain/knowledge/change-set.js';
import type { KnowledgeEntity } from '../../../domain/graph/knowledge-entity.js';
import type { ChangeSetApplyPort,StagedMarkdownFile,TransactionalMarkdownFilePort } from '../../../application/ports/change-set-planning-port.js';
import type { RepositoryLocationRepositoryPort } from '../../../application/ports/artifact-management-port.js';
import type { SqliteDatabase } from './database.js';
import type { DocumentCommitPort } from '../../../application/ports/document-commit-port.js';
import { seedDefaultPolicy } from '../repositories/sqlite-agent-execution-repository.js';

export class SqliteChangeSetApplier implements ChangeSetApplyPort {
 constructor(private readonly db:SqliteDatabase,private readonly files:TransactionalMarkdownFilePort,private readonly repositories:RepositoryLocationRepositoryPort,private readonly committer?:DocumentCommitPort){}
 async apply(changeSet:ChangeSet,repositoryRoot:string|null):Promise<{revision:number;resolvedIds:Record<string,string>}>{
  const now=new Date().toISOString(),revision=changeSet.baseGraphRevision+1,ids:Record<string,string>={},files:StagedMarkdownFile[]=[];
  for(const op of changeSet.operations)if(op.type==='UPSERT_ARTIFACT'||op.type==='CREATE_DECISION_RECORD'){
   const replace=op.type==='UPSERT_ARTIFACT'&&!!op.entityId&&!op.tempId;
   if(replace){const existing=this.db.prepare(`SELECT relative_path FROM artifacts WHERE entity_id=? AND entity_id IN (SELECT id FROM knowledge_entities WHERE project_id=?)`).get(op.entityId,changeSet.projectId) as {relative_path:string}|undefined;if(!existing)throw new Error('El Artifact indicado no existe en el proyecto.');if(existing.relative_path!==op.relativePath)throw new Error('Un upsert de Artifact debe conservar su ruta para no dejar archivos huérfanos.');}
   files.push({relativePath:op.relativePath,content:op.type==='UPSERT_ARTIFACT'?op.markdownContent:decisionMarkdown(op),...(replace?{replaceExisting:true}:{})});
  }
  if(files.length&&!repositoryRoot)throw new Error('Configura el repositorio Git para aplicar cambios con documentos Markdown.');
  const repo=files.length?this.repositories.findPrimaryForProject(changeSet.projectId):null;if(files.length&&!repo)throw new Error('No hay repositorio configurado para guardar los documentos.');
  // Never overwrite documents the user has changed and not committed (D6).
  const paths=files.map(file=>file.relativePath);
  if(paths.length&&this.committer&&repositoryRoot){const dirty=await this.committer.uncommitted(repositoryRoot,paths);if(dirty.length)throw new Error(`No se aplicó el cambio: ${dirty.join(', ')} tiene cambios sin commitear. Commitéalos o descártalos y vuelve a aplicar.`);}
  const commit=()=>this.db.transaction(()=>{
   const row=this.db.prepare('SELECT current_revision FROM projects WHERE id=?').get(changeSet.projectId) as {current_revision:number}|undefined;if(!row)throw new Error('Proyecto no encontrado.');if(row.current_revision!==changeSet.baseGraphRevision)throw new Error('REVISION_CONFLICT: el grafo cambió antes de aplicar.');
   const resolve=(id:string|undefined|null):string|null=>id==null?null:ids[id]??id;
   const creates=changeSet.operations.filter(isCreate);let pending=[...creates];
   while(pending.length){const next:typeof pending=[];let progress=false;for(const op of pending){const parent=parentOf(op);if(parent?.startsWith('$')&&!ids[parent]){next.push(op);continue;}this.insertCreate(op,changeSet,resolve,revision,now,repo?.id??null,ids,files);progress=true;}if(!progress)throw new Error('No se pudieron resolver las referencias temporales en orden topológico.');pending=next;}
   for(const op of changeSet.operations){if(op.type==='CREATE_RELATIONSHIP'){const source=resolve(op.sourceId),target=resolve(op.targetId);if(!source||!target)throw new Error('Relación con referencia temporal sin resolver.');this.db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,?,'CHANGESET',?,NULL,?,?,?)`).run(randomUUID(),changeSet.projectId,source,target,op.edgeType,changeSet.id,op.metadata?JSON.stringify(op.metadata):null,revision,now);}
    else if(op.type==='DELETE_RELATIONSHIP')this.db.prepare('DELETE FROM graph_edges WHERE id=? AND project_id=?').run(resolve(op.edgeId),changeSet.projectId);
    else if(op.type==='SET_PROJECT_PROFILE')this.applyProfile(changeSet.projectId,op,now);
    else if(op.type==='UPDATE_ENTITY_STATUS'){const id=resolve(op.entityId);this.db.prepare('UPDATE knowledge_entities SET status=?,updated_revision=?,updated_at=? WHERE id=? AND project_id=?').run(op.newStatus,revision,now,id,changeSet.projectId);}
    else if(op.type==='UPSERT_ARTIFACT'&&op.entityId&&!op.tempId){const file=files.find(f=>f.relativePath===op.relativePath)!;const result=this.db.prepare('UPDATE artifacts SET artifact_type=?,content_hash=?,sync_status=\'SYNCED\',version=version+1 WHERE entity_id=? AND entity_id IN (SELECT id FROM knowledge_entities WHERE project_id=?)').run(op.artifactType,hash(file.content),op.entityId,changeSet.projectId);if(result.changes!==1)throw new Error('El Artifact indicado dejó de existir antes del commit.');this.db.prepare('UPDATE knowledge_entities SET title=?,updated_revision=?,updated_at=? WHERE id=?').run(op.title,revision,now,op.entityId);this.db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(file.content,op.entityId);}
   }
   for(const file of files){const operation=changeSet.operations.find(op=>(op.type==='UPSERT_ARTIFACT'||op.type==='CREATE_DECISION_RECORD')&&op.relativePath===file.relativePath)!;const entityId=operation.type==='UPSERT_ARTIFACT'&&operation.entityId&&!operation.tempId?operation.entityId:'tempId'in operation&&operation.tempId?ids[operation.tempId]:undefined;if(entityId)this.db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(file.content,entityId);}
   this.db.prepare('UPDATE projects SET current_revision=?,updated_at=? WHERE id=?').run(revision,now,changeSet.projectId);
   this.db.prepare(`UPDATE change_sets SET status='APPLIED',applied_graph_revision=?,applied_at=? WHERE id=?`).run(revision,now,changeSet.id);
  }).immediate();
  await this.files.applyAtomically(repositoryRoot??'',files,commit);
  // Commit the written documents so executions, which start from Git, see them (D6). A failure is reported at execution start.
  if(paths.length&&this.committer&&repositoryRoot)await this.committer.commit(repositoryRoot,paths,`docs(graph): ${changeSet.title} [changeset ${changeSet.id}]`);
  return {revision,resolvedIds:ids};
 }
 private insertCreate(op:Extract<ChangeOperation,{type:'CREATE_MODULE'|'CREATE_FEATURE'|'CREATE_REQUIREMENT'|'CREATE_WORK_ITEM'|'CREATE_DECISION_RECORD'|'UPSERT_ARTIFACT'}>,changeSet:ChangeSet,resolve:(id:string|undefined|null)=>string|null,revision:number,now:string,repositoryId:string|null,ids:Record<string,string>,files:StagedMarkdownFile[]):void{
  const entityId='tempId'in op&&op.tempId?randomUUID():randomUUID();if('tempId'in op&&op.tempId)ids[op.tempId]=entityId;
  const type=op.type==='CREATE_MODULE'?'MODULE':op.type==='CREATE_FEATURE'?'FEATURE':op.type==='CREATE_REQUIREMENT'?'REQUIREMENT':op.type==='CREATE_WORK_ITEM'?'WORK_ITEM':op.type==='CREATE_DECISION_RECORD'?'DECISION_RECORD':'ARTIFACT';
  const parent=parentOf(op);const parentId=resolve(parent);const prefix:Record<string,string>={MODULE:'MOD',FEATURE:'FEAT',REQUIREMENT:'REQ',WORK_ITEM:'TASK',DECISION_RECORD:'ADR',ARTIFACT:'DOC'};const key=this.nextKey(changeSet.projectId,prefix[type]!);
  const title=op.title,summary='summary'in op?op.summary:'';const status='DRAFT';
  this.db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(entityId,changeSet.projectId,type,key,title,summary,status,parentId,revision,revision,now,now);
  if(op.type==='CREATE_MODULE')this.db.prepare('INSERT INTO modules(entity_id,purpose,module_kind) VALUES(?,?,?)').run(entityId,op.purpose,op.moduleKind??'FUNCTIONAL');
  else if(op.type==='CREATE_FEATURE')this.db.prepare('INSERT INTO features(entity_id,scope,priority) VALUES(?,?,?)').run(entityId,op.scope,op.priority);
  else if(op.type==='CREATE_REQUIREMENT')this.db.prepare('INSERT INTO requirements(entity_id,req_type,priority,acceptance_criteria_json) VALUES(?,?,?,?)').run(entityId,op.reqType,op.priority,JSON.stringify(op.acceptanceCriteria));
  else if(op.type==='CREATE_WORK_ITEM')this.db.prepare('INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,?,?,?,?)').run(entityId,op.workType,op.priority??'MEDIUM',JSON.stringify(op.acceptanceCriteria),op.recommendedProfileRole??null);
  else if(op.type==='CREATE_DECISION_RECORD'){const file=files.find(f=>f.relativePath===op.relativePath)!;const contentHash=hash(file.content);this.db.prepare(`INSERT INTO decision_records(entity_id,adr_number,context_md,alternatives_md,decision_md,consequences_md,relative_path,content_hash,sync_status,decided_at) VALUES(?,?,?,?,?,?,?,?,'SYNCED',?)`).run(entityId,Number(key.slice(4)),op.contextMd,op.alternativesMd,op.decisionMd,op.consequencesMd,op.relativePath,contentHash,now);}
  else if(op.type==='UPSERT_ARTIFACT'){if(!repositoryId)throw new Error('Falta el repositorio asociado al documento.');const file=files.find(f=>f.relativePath===op.relativePath)!;this.db.prepare('INSERT INTO artifacts(entity_id,repository_id,artifact_type,relative_path,version,content_hash,sync_status) VALUES(?,?,?,?,1,?,\'SYNCED\')').run(entityId,repositoryId,op.artifactType,op.relativePath,hash(file.content));if(parentId)this.edge(changeSet,op.parentId!,entityId,'DOCUMENTED_BY',revision,now,ids);}
  this.db.prepare('UPDATE fts_knowledge_index SET body_content=? WHERE entity_id=?').run(op.type==='UPSERT_ARTIFACT'?op.markdownContent:op.type==='CREATE_DECISION_RECORD'?decisionMarkdown(op):summary,entityId);
 }
 /** Profile fields replace the project's; verification commands become the allowed commands of every project policy. */
 private applyProfile(projectId:string,op:Extract<ChangeOperation,{type:'SET_PROJECT_PROFILE'}>,now:string):void{
  this.db.prepare('UPDATE projects SET objectives_json=?,out_of_scope_json=?,tech_stack_json=?,rules_json=?,description=COALESCE(?,description),updated_at=? WHERE id=?').run(JSON.stringify(op.objectives),JSON.stringify(op.outOfScope),JSON.stringify(op.techStack),JSON.stringify(op.rules),op.description??null,now,projectId);
  seedDefaultPolicy(this.db,projectId);
  this.db.prepare('UPDATE autonomy_policies SET allowed_commands_json=? WHERE project_id=?').run(JSON.stringify([...new Set(op.verificationCommands)]),projectId);
 }
 private edge(changeSet:ChangeSet,sourceRef:string,target:string,type:'AFFECTS'|'DOCUMENTED_BY',revision:number,now:string,ids:Record<string,string>):void{const source=ids[sourceRef]??sourceRef;this.db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,?,'CHANGESET',?,NULL,NULL,?,?)`).run(randomUUID(),changeSet.projectId,source,target,type,changeSet.id,revision,now);}
 private nextKey(projectId:string,prefix:string):string{const rows=this.db.prepare('SELECT display_key FROM knowledge_entities WHERE project_id=? AND display_key LIKE ?').all(projectId,`${prefix}-%`) as Array<{display_key:string}>;const max=Math.max(0,...rows.map(r=>Number(r.display_key.slice(prefix.length+1))||0));return `${prefix}-${String(max+1).padStart(3,'0')}`;}
}
function isCreate(op:ChangeOperation):op is Extract<ChangeOperation,{type:'CREATE_MODULE'|'CREATE_FEATURE'|'CREATE_REQUIREMENT'|'CREATE_WORK_ITEM'|'CREATE_DECISION_RECORD'|'UPSERT_ARTIFACT'}>{return ['CREATE_MODULE','CREATE_FEATURE','CREATE_REQUIREMENT','CREATE_WORK_ITEM','CREATE_DECISION_RECORD'].includes(op.type)||op.type==='UPSERT_ARTIFACT'&&(!op.entityId||!!op.tempId);}
function parentOf(op:ChangeOperation):string|null{if(op.type==='CREATE_FEATURE')return op.moduleId;if(op.type==='CREATE_REQUIREMENT'||op.type==='CREATE_MODULE'||op.type==='UPSERT_ARTIFACT')return op.parentId??null;if(op.type==='CREATE_WORK_ITEM')return op.parentId;if(op.type==='CREATE_DECISION_RECORD')return null;return null;}
function decisionMarkdown(op:Extract<ChangeOperation,{type:'CREATE_DECISION_RECORD'}>):string{return `# ${op.title}\n\n## Context\n${op.contextMd}\n\n## Alternatives\n${op.alternativesMd}\n\n## Decision\n${op.decisionMd}\n\n## Consequences\n${op.consequencesMd}\n`;}
function hash(content:string):string{return createHash('sha256').update(content).digest('hex');}
