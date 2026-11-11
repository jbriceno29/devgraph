import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/** Writes one file per run; each run takes the next entry of `blocks` (raw text) as its ```propuestas block, if any. */
class ProposalAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;runs=0;blocks:Array<string|null>=[];
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{
  this.runs+=1;writeFileSync(join(input.workingDirectory,'src',`run-${this.runs}.ts`),'export const done = true;\n');
  const block=this.blocks.shift()??null;
  yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary:`**Hecho** Tarea cerrada.${block===null?'':`\n\n\`\`\`propuestas\n${block}\n\`\`\``}`};
 }
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

async function setup(blocks:Array<string|null>){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-pilot-proposals-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
 writeFileSync(join(repo,'check.mjs'),"console.log('checks ok');\n");writeFileSync(join(repo,'src','base.ts'),'export const base = 1;\n');
 execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});
 const workspaceRoot=join(root,'workspace');const adapter=new ProposalAdapter();adapter.blocks=blocks;
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:adapter});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Pilot proposals',slug:'pilot-proposals'}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','Tareas','','DRAFT',opened.selectedEntityId);db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  insert.run('feat',project.id,'FEATURE','FEAT-001','Gestión de tareas','','DRAFT','mod');db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
  for(const [id,key,title,status] of [['t1','TASK-001','Crear tareas','READY'],['t2','TASK-002','Listar tareas','BLOCKED']]){insert.run(id,project.id,'WORK_ITEM',key,title,'',status,'feat');db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(id);}
  db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES('d1',?,'t2','t1','DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`).run(project.id);
 }finally{closeDatabase(db);}
 const policy=await core.handle({channel:'policy:get',args:[project.id]}) as Record<string,unknown>;
 await core.handle({channel:'policy:update',args:[project.id,{...policy,writablePaths:['src/**'],allowedCommands:['node check.mjs']}]});
 const pilot=(command:string,...args:unknown[])=>core.handle({channel:`pilot:${command}` as never,args:[project.id,'feat',...args]});
 const status=()=>pilot('get') as Promise<{run:{status:string;reason:string|null}|null;events:Array<{kind:string;message:string}>;tasks:Array<{displayKey:string;title:string;status:string}>}>;
 const until=async(predicate:(value:Awaited<ReturnType<typeof status>>)=>boolean,timeout=20_000)=>{const started=Date.now();for(;;){const value=await status();if(predicate(value))return value;if(Date.now()-started>timeout)throw new Error(`timeout: ${JSON.stringify(value.run)} ${value.events.map(event=>event.kind).join(',')}`);await new Promise(resolve=>setTimeout(resolve,100));}};
 const changeSets=async()=>await core.handle({channel:'changeset:list',args:[project.id]}) as Array<{id:string;status:string;originType:string}>;
 // Grouping off: these tests count one run per task to follow the proposals; grouping has its own tests in feature-pilot.test.ts.
 await pilot('set_autonomy',{level:'PILOT',groupTasks:false});
 return {adapter,rootId:opened.selectedEntityId,pilot,status,until,changeSets};
}

const newTask=(tempId:string,title:string)=>({type:'CREATE_WORK_ITEM',tempId,parentId:'feat',workType:'TASK',title,summary:'s',acceptanceCriteria:['ok']});

describe('autopilot and agent plan proposals',()=>{
 it('picks up the tasks of an applied proposal and closes them without intervention',async()=>{
  const {pilot,until,adapter}=await setup([JSON.stringify({title:'Validación de tareas',rationale:'Falta validar.',operations:[newTask('$a','Validar tareas'),{type:'CREATE_RELATIONSHIP',sourceId:'$a',targetId:'t1',edgeType:'DEPENDS_ON'}]})]);
  await pilot('start',{acknowledgeCost:true});
  const done=await until(value=>value.run?.status==='COMPLETED');
  expect(done.tasks.map(task=>`${task.title}:${task.status}`).sort()).toEqual(['Crear tareas:DONE','Listar tareas:DONE','Validar tareas:DONE']);
  expect(adapter.runs).toBe(3);
  const kinds=done.events.map(event=>event.kind);
  expect(kinds).not.toContain('WAITING_USER');
  expect(kinds.slice(0,4)).toEqual(['STARTED','TASK_STARTED','TASK_ACCEPTED','PLAN_CHANGED']);
  expect(done.events.find(event=>event.kind==='PLAN_CHANGED')!.message).toContain('Validación de tareas');
 });

 it('waits for the user on a scope change, leaves it unapplied, and resumes with what the graph holds',async()=>{
  const {pilot,until,rootId,adapter,changeSets}=await setup([]);
  adapter.blocks=[JSON.stringify({title:'Nuevo requisito',rationale:'Cambia el alcance.',operations:[{type:'CREATE_REQUIREMENT',tempId:'$r',parentId:rootId,title:'Exportar tareas',summary:'s',reqType:'FUNCTIONAL',priority:'MEDIUM',acceptanceCriteria:[]}]})];
  await pilot('start',{acknowledgeCost:true});
  const waiting=await until(value=>value.run?.status==='WAITING_USER');
  expect(waiting.run!.reason).toMatch(/^El agente propone cambios al plan que requieren tu decisión: Nuevo requisito\. .*alcance.*Revísalos en Planificación y reanuda el piloto\.$/);
  expect(waiting.events.map(event=>event.kind).slice(-3)).toEqual(['TASK_ACCEPTED','PLAN_PROPOSAL','WAITING_USER']);
  expect(waiting.tasks.map(task=>task.status)).toEqual(['DONE','READY']);
  const stored=(await changeSets()).find(item=>item.originType==='AGENT_EXECUTION')!;
  expect(['VALIDATED','PENDING_APPROVAL']).toContain(stored.status);

  // Resuming without resolving the proposal is allowed: the pilot goes on with the current plan.
  await pilot('resume');
  const done=await until(value=>value.run?.status==='COMPLETED');
  expect(done.tasks.map(task=>task.status)).toEqual(['DONE','DONE']);
  expect(['VALIDATED','PENDING_APPROVAL']).toContain((await changeSets()).find(item=>item.id===stored.id)!.status);
 });

 it('logs an invalid proposal and keeps going until the feature is done',async()=>{
  const {pilot,until}=await setup(['{"title": "roto", operations: [']);
  await pilot('start',{acknowledgeCost:true});
  const done=await until(value=>value.run?.status==='COMPLETED');
  expect(done.tasks.map(task=>task.status)).toEqual(['DONE','DONE']);
  const kinds=done.events.map(event=>event.kind);
  expect(kinds).toEqual(['STARTED','TASK_STARTED','TASK_ACCEPTED','PLAN_PROPOSAL','TASK_STARTED','TASK_ACCEPTED','COMPLETED']);
  expect(done.events.find(event=>event.kind==='PLAN_PROPOSAL')!.message).toContain('El piloto continúa');
 });
});
