import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import { buildPlannerPrompt } from '../../src/infrastructure/ai/change-set-planning-contract.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/**
 * Follows `WRITE <path> :: <content>` / `DELETE <path>` directives from the task summary and closes with a
 * structured summary; records every prompt it receives.
 */
class MemoryAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;prompts:string[]=[];
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{
  this.prompts.push(input.prompt);
  const workItem=input.prompt.slice(input.prompt.indexOf('# WorkItem'),input.prompt.indexOf('# Criterios'));
  for(const match of workItem.matchAll(/WRITE (\S+) :: ([^\n]+)/g)){const target=join(input.workingDirectory,match[1]!);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,`${match[2]}\n`);}
  for(const match of workItem.matchAll(/DELETE (\S+)/g))unlinkSync(join(input.workingDirectory,match[1]!));
  const title=/# WorkItem\n([^\n]+)/.exec(input.prompt)?.[1]??'';
  const convention=title.includes('Crear tareas')?'\n**Convenciones**\n- Toda validación lanza RangeError con mensaje en español.':'\n**Convenciones** Ninguna.';
  yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary:`**Hecho** ${title}.\n**Decisiones** Las tareas viven en src/tasks.ts como un arreglo exportado \`tasks\`.${convention}\n**Pendiente** Nada.`};
 }
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

async function setup(){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-memory-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
 writeFileSync(join(repo,'src','old.ts'),'export const old = 1;\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});
 const workspaceRoot=join(root,'workspace');const adapter=new MemoryAdapter();
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:adapter});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Memory',slug:'memory',rules:['Usa TypeScript estricto.']}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','Tareas','','DRAFT',opened.selectedEntityId);db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  insert.run('feat',project.id,'FEATURE','FEAT-001','Gestión de tareas','','DRAFT','mod');db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
  const tasks=[
   ['t1','TASK-001','Crear tareas','WRITE src/tasks.ts :: export const tasks = []; DELETE src/old.ts','READY'],
   ['t2','TASK-002','Listar tareas','WRITE src/list.ts :: import { tasks } from "./tasks";','BLOCKED'],
   ['t3','TASK-003','Contar tareas','WRITE src/count.ts :: export const count = 0;','READY'],
  ];
  for(const [id,key,title,summary,status] of tasks){insert.run(id,project.id,'WORK_ITEM',key,title,summary,status,'feat');db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(id);}
  db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('d1',?,'t2','t1','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`).run(project.id);
 }finally{closeDatabase(db);}
 const profileId=(await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string}>).find(item=>item.roleKey==='DEVELOPER')!.id;
 const runAndAccept=async(workItemId:string)=>{
  const started=await core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId,profileId}]}) as {id:string};
  for(let attempt=0;attempt<100;attempt+=1){const current=(await core.handle({channel:'execution:list',args:[project.id]}) as Array<{id:string;status:string}>).find(item=>item.id===started.id)!;if(current.status==='COMPLETED')break;if(['FAILED','CANCELLED'].includes(current.status))throw new Error(current.status);await new Promise(resolve=>setTimeout(resolve,30));}
  return core.handle({channel:'execution:accept',args:[started.id]}) as Promise<{merged:boolean;execution:{mergedCommit:string}}>;
 };
 return {core,repo,workspaceRoot,projectId:project.id,adapter,runAndAccept};
}

describe('memory that flows between tasks (Stage 2)',()=>{
 it('records the outcome and code evidence of an accepted task, and hands both to the tasks that follow',async()=>{
  const {core,workspaceRoot,projectId,adapter,runAndAccept}=await setup();
  const accepted=await runAndAccept('t1');expect(accepted.merged).toBe(true);

  const inspector=await core.handle({channel:'entity:get_inspector_details',args:['t1']}) as {outcome:{summary:string;files:Array<{path:string;status:string}>;mergedCommit:string}};
  expect(inspector.outcome.summary).toContain('**Decisiones** Las tareas viven en src/tasks.ts');
  expect(inspector.outcome.files).toEqual([{path:'src/old.ts',status:'DELETED'},{path:'src/tasks.ts',status:'ADDED'}]);
  expect(inspector.outcome.mergedCommit).toBe(accepted.execution.mergedCommit);

  const db=openDatabase({filename:join(workspaceRoot,'projects',projectId,'workspace.sqlite'),initialize:false});
  try{
   const evidence=db.prepare(`SELECT e.display_key,e.title,e.status,c.commit_sha,g.provenance FROM graph_edges g JOIN knowledge_entities e ON e.id=g.target_id JOIN code_references c ON c.entity_id=e.id WHERE g.source_id='t1' AND g.edge_type='MODIFIES' ORDER BY e.title`).all();
   expect(evidence).toEqual([
    {display_key:'CODE-001',title:'src/old.ts',status:'REMOVED',commit_sha:accepted.execution.mergedCommit,provenance:'EXECUTION'},
    {display_key:'CODE-002',title:'src/tasks.ts',status:'ACTIVE',commit_sha:accepted.execution.mergedCommit,provenance:'EXECUTION'},
   ]);
  }finally{closeDatabase(db);}

  // TASK-002 depends on TASK-001: its prompt carries TASK-001's closing summary and the file it created.
  expect((await core.handle({channel:'entity:get_inspector_details',args:['t2']}) as {entity:{status:string}}).entity.status).toBe('READY');
  await runAndAccept('t2');
  const promptForT2=adapter.prompts.at(-1)!;
  expect(promptForT2).toContain('Resultado al cerrar la tarea');
  expect(promptForT2).toContain('Las tareas viven en src/tasks.ts como un arreglo exportado `tasks`.');
  expect(promptForT2).toContain('Archivo src/tasks.ts');
  expect(promptForT2).not.toContain('Archivo src/old.ts');

  // Stage 6: the graph can show which entities formed TASK-002's context, and at which authority tier.
  const flow=await core.handle({channel:'graph:context_flow',args:[projectId,'t2']}) as {executionId:string|null;sources:Array<{entityId:string;tier:number}>;conventions:string[]};
  expect(flow.executionId).not.toBeNull();
  expect(flow.sources.map(source=>source.entityId)).toEqual(expect.arrayContaining(['t1','feat']));
  expect(flow.sources.some(source=>source.entityId==='t2')).toBe(false);
  expect(flow.conventions.join('\n')).toContain('RangeError');
  expect(await core.handle({channel:'graph:context_flow',args:[projectId,'t3']})).toEqual({executionId:null,snapshotId:null,sources:[],conventions:[]});

  // TASK-003 has no dependency but shares the feature: finished siblings are part of its memory too.
  const preview=await core.handle({channel:'context:preview_package',args:[{projectId,focusEntityId:'t3',maxAllowedTokens:32_000}]}) as {packageText:string;snapshot:{includedSources:Array<{entityKey?:string;authorityTier:number;sourceType:string}>}};
  expect(preview.snapshot.includedSources.filter(source=>source.entityKey?.startsWith('TASK-')).map(source=>source.entityKey).sort()).toEqual(['TASK-001','TASK-002','TASK-003']);
  expect(preview.snapshot.includedSources.filter(source=>source.sourceType==='CODE_FILE').every(source=>source.authorityTier===4)).toBe(true);
  expect(preview.packageText).toContain('Archivo src/list.ts');

  // A convention declared by TASK-001 is a tier-1 rule for every later task, even without any edge to it.
  const convention=preview.snapshot.includedSources.find(source=>source.entityKey==='CONV-TASK-001-1') as {authorityTier:number}|undefined;
  expect(convention?.authorityTier).toBe(1);
  expect(preview.packageText).toMatch(/<Constraints>[\s\S]*Toda validación lanza RangeError[\s\S]*<\/Constraints>/);
  expect(adapter.prompts.at(-1)).toContain('Toda validación lanza RangeError');
 });

 it('hands a direct prerequisite its decisions and pending items, and a further one only what it did; conventions only as rules',async()=>{
  const {core,workspaceRoot,projectId,adapter,runAndAccept}=await setup();
  const db=openDatabase({filename:join(workspaceRoot,'projects',projectId,'workspace.sqlite'),initialize:false});
  try{db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('d2',?,'t3','t2','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`).run(projectId);db.prepare("UPDATE knowledge_entities SET status='BLOCKED' WHERE id='t3'").run();}finally{closeDatabase(db);}
  await runAndAccept('t1');await runAndAccept('t2');
  await core.handle({channel:'workitem:set_status',args:[projectId,'t3','READY','dependencias cumplidas']}).catch(()=>undefined);
  await runAndAccept('t3');
  const prompt=adapter.prompts.at(-1)!;
  const decision='Las tareas viven en src/tasks.ts como un arreglo exportado `tasks`.';
  // TASK-002 (direct) keeps its decisions; TASK-001 (two steps away) only what it did.
  expect(prompt.split(decision)).toHaveLength(2);
  expect(prompt).toContain('Resultado al cerrar la tarea');
  // The convention TASK-001 declared reaches the prompt once, as a rule, and not again inside the summaries.
  expect(prompt.split('Toda validación lanza RangeError con mensaje en español.')).toHaveLength(2);
 });

 it('warns when the mandatory context alone exceeds the token budget',async()=>{
  const {core,projectId}=await setup();
  const preview=await core.handle({channel:'context:preview_package',args:[{projectId,focusEntityId:'t1',maxAllowedTokens:5}]}) as {warnings:string[]};
  expect(preview.warnings[0]).toContain('superan el presupuesto de 5');
 });
});

describe('planner prompt',()=>{
 it('explains the graph rules the validator enforces',()=>{
  const prompt=buildPlannerPrompt({prompt:'x',project:{name:'P',description:null,rules:[],revision:1},focusEntity:null,entities:[],relationships:[]});
  expect(prompt).toContain('put the ARTIFACT under PROJECT_ROOT and add CREATE_RELATIONSHIP DOCUMENTED_BY');
  expect(prompt).toContain('DEPENDS_ON between two WORK_ITEMs');
 });
});

describe('context noise (third measurement)',()=>{
 it('keeps pending tasks out of the text search: their specs are future work, not knowledge',async()=>{
  const {core,projectId}=await setup();
  // TASK-002 and TASK-003 are pending and share words with TASK-001's summary.
  const preview=await core.handle({channel:'context:preview_package',args:[{projectId,focusEntityId:'t1',maxAllowedTokens:32_000,query:'tareas listar contar'}]}) as {snapshot:{includedSources:Array<{entityKey?:string;retrievalOrigin:string}>}};
  expect(preview.snapshot.includedSources.filter(source=>source.retrievalOrigin==='FULL_TEXT_SEARCH'&&source.entityKey?.startsWith('TASK-'))).toEqual([]);
 });
});
