import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/**
 * Follows `WRITE <path> :: <content>` in every part of a grouped prompt (or in the single WorkItem, or in the
 * reviewer's feedback) and closes with one summary section per task, a shared summary, or a failure.
 */
class GroupAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;prompts:string[]=[];mode:'per-task'|'shared'|'fail'='per-task';
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{
  this.prompts.push(input.prompt);
  const body=input.prompt.slice(0,input.prompt.indexOf('# Política de ejecución'));
  const section=body.includes('# Ajustes solicitados')?body.slice(body.indexOf('# Ajustes solicitados')):body;
  for(const match of section.matchAll(/WRITE (\S+) :: ([^\n]+)/g)){const target=join(input.workingDirectory,match[1]!);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,`${match[2]}\n`);}
  const keys=[...new Set([...body.matchAll(/## Parte \d+ de \d+: (TASK-\d+)/g)].map(match=>match[1]!))];
  if(this.mode==='fail'){yield {type:'EXECUTION_FAILED',timestamp:new Date().toISOString(),errorCode:'AGENT_ERROR',errorMessage:'No pude terminar el grupo.',isRecoverable:true};return;}
  const summary=this.mode==='per-task'&&keys.length
   ?keys.map(key=>`## ${key}\n**Hecho** Parte ${key} lista.\n**Decisiones** Decisión propia de ${key}.\n**Convenciones** Ninguna.\n**Pendiente** Nada.`).join('\n\n')
   :`**Hecho** Todo el grupo (${keys.join(', ')||'una tarea'}).\n**Decisiones** Una sola decisión para todo.\n**Convenciones** Ninguna.\n**Pendiente** Nada.`;
  yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary};
 }
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

async function setup(){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-group-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
 writeFileSync(join(repo,'src','base.ts'),'export const base = 1;\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});
 const workspaceRoot=join(root,'workspace');const adapter=new GroupAdapter();
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:adapter});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Grupos',slug:'grupos'}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','Tareas','','DRAFT',opened.selectedEntityId);db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  for(const [id,key,title] of [['feat','FEAT-001','Gestión de tareas'],['feat2','FEAT-002','Informes']]){insert.run(id,project.id,'FEATURE',key,title,'','DRAFT','mod');db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES(?,'s','HIGH')").run(id);}
  const tasks:Array<[string,string,string,string,string,string]>=[
   ['t1','TASK-001','Crear tareas','WRITE src/tasks.ts :: export const tasks = [];','READY','feat'],
   ['t2','TASK-002','Listar tareas','WRITE src/list.ts :: export const list = 1;','BLOCKED','feat'],
   ['t3','TASK-003','Contar tareas','WRITE src/count.ts :: export const count = 0;','READY','feat'],
   ['t4','TASK-004','Exportar tareas','WRITE src/export.ts :: export const csv = "";','BLOCKED','feat'],
   ['t5','TASK-005','Informe semanal','WRITE src/report.ts :: export const report = 1;','READY','feat2'],
  ];
  for(const [id,key,title,summary,status,parent] of tasks){insert.run(id,project.id,'WORK_ITEM',key,title,summary,status,parent);db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH',?,'DEVELOPER')`).run(id,JSON.stringify([{id:`${id}-c1`,description:`Criterio de ${key}`,verified:false}]));}
  const edge=db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`);
  edge.run('e1',project.id,'t2','t1');edge.run('e2',project.id,'t4','t2');
 }finally{closeDatabase(db);}
 const profileId=(await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string}>).find(item=>item.roleKey==='DEVELOPER')!.id;
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 const status=async(id:string)=>(await core.handle({channel:'graph:get_view',args:[project.id]}) as {nodes:Array<{id:string;status:string}>}).nodes.find(node=>node.id===id)!.status;
 type Execution={id:string;status:string;baseBranch:string;finalCommit:string;coveredWorkItemIds:string[];mergedCommit:string|null};
 const wait=async(id:string):Promise<Execution>=>{
  for(let attempt=0;attempt<200;attempt+=1){
   const current=(await core.handle({channel:'execution:list',args:[project.id]}) as Execution[]).find(item=>item.id===id)!;
   if(['COMPLETED','FAILED','CANCELLED'].includes(current.status))return current;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('run did not finish');
 };
 const start=async(workItemId:string,workItemIds?:string[])=>core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId,...(workItemIds?{workItemIds}:{}),profileId}]}) as Promise<Execution>;
 const outcome=async(id:string)=>((await core.handle({channel:'entity:get_inspector_details',args:[id]})) as {outcome:{summary:string;mergedCommit:string|null}|null}).outcome;
 return {core,projectId:project.id,adapter,git,status,wait,start,outcome};
}

describe('grouped runs: one execution covers several tasks (Etapa 0, entrega 0.3)',()=>{
 it('runs three tasks together, moves them as one, commits one squash with a trailer per task and leaves one outcome per task',async()=>{
  const {core,projectId,adapter,git,status,wait,start,outcome}=await setup();
  const started=await start('t1',['t2','t3']);
  expect(started.coveredWorkItemIds).toEqual(['t1','t2','t3']);
  expect(await status('t1')).toBe('IN_PROGRESS');expect(await status('t2')).toBe('IN_PROGRESS');expect(await status('t3')).toBe('IN_PROGRESS');
  const finished=await wait(started.id);
  expect(finished.status).toBe('COMPLETED');
  for(const id of ['t1','t2','t3'])expect(await status(id)).toBe('IN_REVIEW');
  expect(await status('t4')).toBe('BLOCKED');

  const prompt=adapter.prompts[0]!;
  expect(prompt).toContain('# Tareas de este grupo');
  expect(prompt).toContain('## Parte 1 de 3: TASK-001 Crear tareas');
  expect(prompt).toContain('## Parte 2 de 3: TASK-002 Listar tareas');
  expect(prompt).toContain('## Parte 3 de 3: TASK-003 Contar tareas');
  expect(prompt).toContain('### Criterios de aceptación de TASK-002\n- Criterio de TASK-002');
  expect(prompt.match(/Recuerda: los criterios de esta parte siguen las convenciones del proyecto/g)).toHaveLength(3);
  expect(prompt).toContain('un apartado encabezado con la clave de cada tarea (`## TASK-001`, `## TASK-002`, `## TASK-003`)');
  expect(prompt).not.toContain('# WorkItem');

  const accepted=await core.handle({channel:'execution:accept',args:[started.id]}) as {merged:boolean;execution:{mergedCommit:string}};
  expect(accepted.merged).toBe(true);
  expect(git('log','--format=%s','main..feature/feat-001-gestion-de-tareas')).toBe('TASK-001, TASK-002, TASK-003: Crear tareas · Listar tareas · Contar tareas');
  expect(git('log','-1','--format=%b','feature/feat-001-gestion-de-tareas')).toContain('Task: TASK-001 Crear tareas\nTask: TASK-002 Listar tareas\nTask: TASK-003 Contar tareas');
  expect(git('show','--name-only','--format=','feature/feat-001-gestion-de-tareas').split('\n').sort()).toEqual(['src/count.ts','src/list.ts','src/tasks.ts']);
  for(const id of ['t1','t2','t3'])expect(await status(id)).toBe('DONE');
  expect(await status('t4')).toBe('READY');

  const second=await outcome('t2');
  expect(second?.summary).toContain('## TASK-002');
  expect(second?.summary).toContain('Decisión propia de TASK-002');
  expect(second?.summary).not.toContain('Decisión propia de TASK-001');
  expect(second?.mergedCommit).toBe(accepted.execution.mergedCommit);
  expect((await outcome('t3'))?.summary).toContain('Decisión propia de TASK-003');

  // The next task of the feature receives the memory of the task it depends on, not the whole group's.
  const preview=await core.handle({channel:'context:preview_package',args:[{projectId,focusEntityId:'t4',maxAllowedTokens:32_000,maxHops:2}]}) as {packageText:string};
  expect(preview.packageText).toContain('Decisión propia de TASK-002');
 });

 it('a failed group returns every task: READY the ones that can run, BLOCKED the ones waiting for a task of the group',async()=>{
  const {adapter,status,wait,start}=await setup();
  adapter.mode='fail';
  const started=await start('t1',['t2','t3']);
  expect((await wait(started.id)).status).toBe('FAILED');
  expect(await status('t1')).toBe('READY');
  expect(await status('t2')).toBe('BLOCKED');
  expect(await status('t3')).toBe('READY');
 });

 it('refuses a member blocked by a task outside the group, a task of another feature, and a task with an active run',async()=>{
  const {start,wait,adapter}=await setup();
  await expect(start('t1',['t4'])).rejects.toThrow('La tarea TASK-004 depende de tareas sin terminar: TASK-002 (BLOCKED).');
  await expect(start('t1',['t5'])).rejects.toThrow('La tarea TASK-005 no es de la misma feature que TASK-001');
  adapter.mode='fail';
  const started=await start('t1',['t2']);
  await expect(start('t3',['t2'])).rejects.toThrow('La tarea TASK-002 debe estar lista o bloqueada solo por tareas del grupo para ejecutarse en grupo (está en IN_PROGRESS).');
  await expect(start('t1',['t3'])).rejects.toThrow('La tarea TASK-001 debe estar en estado READY para iniciar.');
  await wait(started.id);
 });

 it('request changes keeps the group, and accepting the revision closes every task with one commit',async()=>{
  const {core,git,status,wait,start}=await setup();
  const first=await wait((await start('t1',['t2','t3'])).id);
  const revision=await core.handle({channel:'execution:request_changes',args:[{executionId:first.id,feedback:'WRITE src/extra.ts :: export const extra = true;'}]}) as {id:string;coveredWorkItemIds:string[]};
  expect(revision.coveredWorkItemIds).toEqual(['t1','t2','t3']);
  expect((await wait(revision.id)).status).toBe('COMPLETED');
  const accepted=await core.handle({channel:'execution:accept',args:[revision.id]}) as {merged:boolean};
  expect(accepted.merged).toBe(true);
  expect(git('log','--format=%s','main..feature/feat-001-gestion-de-tareas').split('\n')).toHaveLength(1);
  expect(git('show','--name-only','--format=','feature/feat-001-gestion-de-tareas').split('\n').sort()).toEqual(['src/count.ts','src/extra.ts','src/list.ts','src/tasks.ts']);
  for(const id of ['t1','t2','t3'])expect(await status(id)).toBe('DONE');
 });

 it('when the agent does not separate the summary, every task keeps the shared summary, flagged as such',async()=>{
  const {core,adapter,wait,start,outcome}=await setup();
  adapter.mode='shared';
  const started=await wait((await start('t1',['t2'])).id);
  await core.handle({channel:'execution:accept',args:[started.id]});
  for(const id of ['t1','t2']){
   const summary=(await outcome(id))?.summary??'';
   expect(summary.startsWith('(Resumen compartido del grupo TASK-001, TASK-002: el agente no separó los apartados por tarea.)')).toBe(true);
   expect(summary).toContain('Una sola decisión para todo');
  }
 });

 it('a single task keeps the prompt and the commit exactly as before',async()=>{
  const {core,adapter,git,wait,start}=await setup();
  const started=await start('t3');
  expect(started.coveredWorkItemIds).toEqual(['t3']);
  await wait(started.id);
  expect(adapter.prompts[0]).toContain('# WorkItem\nContar tareas');
  expect(adapter.prompts[0]).not.toContain('Tareas de este grupo');
  await core.handle({channel:'execution:accept',args:[started.id]});
  expect(git('log','--format=%s%n%b','main..feature/feat-001-gestion-de-tareas')).toBe(`TASK-003: Contar tareas\nGraph Workspace execution ${started.id}`);
 });
});
