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

type Behaviour='good'|'bad-then-good'|'hang'|'high-usage';
/**
 * Writes src/<task>.txt. The check command (`node check.mjs`) fails when a file says "bad"; with `bad-then-good`
 * the first attempt writes "bad" and a retry (which carries "# Intento anterior") writes "ok".
 */
class PilotAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;prompts:string[]=[];
 constructor(private readonly behaviour:Behaviour='good'){}
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{
  this.prompts.push(input.prompt);
  const key=/TASK-\d+/.exec(/# WorkItem\n([^\n]+)/.exec(input.prompt)?.[1]??'')?.[0]??'task';
  if(this.behaviour==='hang'){yield {type:'SESSION_INITIALIZED',timestamp:new Date().toISOString(),externalSessionId:'s'};await new Promise(()=>undefined);}
  if(this.behaviour==='high-usage')yield {type:'RATE_LIMIT_UPDATED',timestamp:new Date().toISOString(),status:'allowed',window:'five_hour',utilization:0.95,resetsAt:new Date(Date.now()+3_600_000).toISOString()};
  const content=this.behaviour==='bad-then-good'&&!input.prompt.includes('# Intento anterior')?'bad':'ok';
  writeFileSync(join(input.workingDirectory,'src',`${key}.txt`),`${content}\n`);
  yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary:`**Hecho** ${key}.`};
 }
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

async function setup(behaviour:Behaviour,options:{checks?:boolean;tasks?:Array<[string,string,string]>;edges?:Array<[string,string]>}={}){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-pilot-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
 writeFileSync(join(repo,'check.mjs'),"import { readdirSync, readFileSync } from 'node:fs';\nfor (const f of readdirSync('src')) if (readFileSync('src/'+f,'utf8').includes('bad')) { console.error('bad content in', f); process.exit(1); }\nconsole.log('checks ok');\n");
 writeFileSync(join(repo,'src','base.txt'),'ok\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});
 const workspaceRoot=join(root,'workspace');const adapter=new PilotAdapter(behaviour);const events:Array<{channel:string;payload:unknown}>=[];
 const core=createWorkspaceCore(workspaceRoot,(channel,payload)=>events.push({channel,payload}),{agentAdapter:adapter});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Pilot',slug:'pilot'}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','M','','DRAFT',opened.selectedEntityId);db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  insert.run('feat',project.id,'FEATURE','FEAT-001','Pilot feature','','DRAFT','mod');db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
  for(const [id,key,status] of options.tasks??[['t1','TASK-001','READY'],['t2','TASK-002','BLOCKED']]){insert.run(id,project.id,'WORK_ITEM',key,`${key} work`,'s',status,'feat');db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(id);}
  (options.edges??[['t2','t1']]).forEach(([source,target],index)=>db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`).run(`e${index}`,project.id,source,target));
 }finally{closeDatabase(db);}
 const policy=await core.handle({channel:'policy:get',args:[project.id]}) as Record<string,unknown>;
 await core.handle({channel:'policy:update',args:[project.id,{...policy,writablePaths:['src/**'],allowedCommands:options.checks===false?[]:['node check.mjs']}]});
 const pilot=(command:string,...args:unknown[])=>core.handle({channel:`pilot:${command}` as never,args:[project.id,'feat',...args]});
 const status=()=>pilot('get') as Promise<{run:{status:string;reason:string|null}|null;events:Array<{kind:string;message:string}>;tasks:Array<{displayKey:string;status:string}>}>;
 const until=async(predicate:(value:Awaited<ReturnType<typeof status>>)=>boolean,timeout=20_000)=>{const started=Date.now();for(;;){const value=await status();if(predicate(value))return value;if(Date.now()-started>timeout)throw new Error(`timeout: ${JSON.stringify(value.run)} ${value.events.map(event=>event.kind).join(',')}`);await new Promise(resolve=>setTimeout(resolve,100));}};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 return {core,projectId:project.id,adapter,events,pilot,status,until,git,workspaceRoot};
}

describe('feature autopilot (Stage 3)',()=>{
 it('refuses to start unless the feature is in pilot mode and the cost was acknowledged',async()=>{
  const {pilot}=await setup('good');
  await expect(pilot('start',{acknowledgeCost:true})).rejects.toThrow('Activa el nivel "Piloto"');
  await pilot('set_autonomy',{level:'PILOT'});
  await expect(pilot('start',{acknowledgeCost:false})).rejects.toThrow('Confirma que entiendes el costo');
 });

 it('closes a whole feature in dependency order, accepting each task through the gates',async()=>{
  const {pilot,until,git,events}=await setup('good');
  await pilot('set_autonomy',{level:'PILOT'});
  await pilot('start',{acknowledgeCost:true});
  const done=await until(value=>value.run?.status==='COMPLETED');
  expect(done.tasks.map(task=>`${task.displayKey}:${task.status}`)).toEqual(['TASK-001:DONE','TASK-002:DONE']);
  expect(done.events.map(event=>event.kind)).toEqual(['STARTED','TASK_STARTED','TASK_ACCEPTED','TASK_STARTED','TASK_ACCEPTED','COMPLETED']);
  expect(git('log','--format=%s','main..feature/feat-001-pilot-feature').split('\n')).toEqual(['TASK-002: TASK-002 work','TASK-001: TASK-001 work']);
  expect(git('branch','--show-current')).toBe('main');
  expect(events.some(event=>event.channel==='pilot:updated')).toBe(true);
 });

 it('retries a failed task with the failure as context, and escalates after the last attempt',async()=>{
  const retried=await setup('bad-then-good',{tasks:[['t1','TASK-001','READY']],edges:[]});
  await retried.pilot('set_autonomy',{level:'PILOT',maxAttempts:2});
  await retried.pilot('start',{acknowledgeCost:true});
  const done=await retried.until(value=>value.run?.status==='COMPLETED');
  expect(done.events.map(event=>event.kind)).toEqual(['STARTED','TASK_STARTED','RETRY','TASK_STARTED','TASK_ACCEPTED','COMPLETED']);
  expect(retried.adapter.prompts[1]).toContain('# Intento anterior');expect(retried.adapter.prompts[1]).toContain('bad content in TASK-001.txt');

  const failing=await setup('bad-then-good',{tasks:[['t1','TASK-001','READY']],edges:[]});
  await failing.pilot('set_autonomy',{level:'PILOT',maxAttempts:1});
  await failing.pilot('start',{acknowledgeCost:true});
  const waiting=await failing.until(value=>value.run?.status==='WAITING_USER');
  expect(waiting.run!.reason).toContain('TASK-001 falló 1 vez');
  expect(waiting.tasks[0]!.status).toBe('READY');
 });

 it('does not accept on its own without verification commands',async()=>{
  const {pilot,until}=await setup('good',{checks:false,tasks:[['t1','TASK-001','READY']],edges:[]});
  await pilot('set_autonomy',{level:'PILOT'});
  await pilot('start',{acknowledgeCost:true});
  const waiting=await until(value=>value.run?.status==='WAITING_USER');
  expect(waiting.run!.reason).toContain('no hay comandos de verificación');
  expect(waiting.tasks[0]!.status).toBe('IN_REVIEW');
 });

 it('in auto-accept mode integrates a manually started run once its gates pass',async()=>{
  const {core,projectId,pilot,until}=await setup('good',{tasks:[['t1','TASK-001','READY']],edges:[]});
  await pilot('set_autonomy',{level:'AUTO_ACCEPT'});
  const profileId=(await core.handle({channel:'agent:list_profiles',args:[projectId]}) as Array<{id:string;roleKey:string}>).find(item=>item.roleKey==='DEVELOPER')!.id;
  const started=await core.handle({channel:'execution:start',args:[{projectId,workItemId:'t1',profileId}]}) as {id:string};
  await until(value=>value.tasks[0]!.status==='DONE');
  const execution=(await core.handle({channel:'execution:list',args:[projectId]}) as Array<{id:string;reviewStatus:string;reviewNote:string}>).find(item=>item.id===started.id)!;
  expect(execution).toMatchObject({reviewStatus:'ACCEPTED',reviewNote:expect.stringContaining('auto-aceptar')});
 });

 it('stops on request, cancelling the run in flight and leaving the task available',async()=>{
  const {core,projectId,pilot,until}=await setup('hang',{tasks:[['t1','TASK-001','READY']],edges:[]});
  await pilot('set_autonomy',{level:'PILOT'});
  await pilot('start',{acknowledgeCost:true});
  await until(value=>value.tasks[0]!.status==='IN_PROGRESS');
  const stopped=await pilot('stop') as {status:string};
  expect(stopped.status).toBe('STOPPED');
  const done=await until(value=>value.tasks[0]!.status==='READY');
  expect(done.run!.status).toBe('STOPPED');
  expect((await core.handle({channel:'execution:list',args:[projectId]}) as Array<{status:string}>)[0]!.status).toBe('CANCELLED');
 });

 it('pauses before the next task when the usage window passes the threshold',async()=>{
  const {pilot,until}=await setup('high-usage');
  await pilot('set_autonomy',{level:'PILOT',usagePauseThreshold:0.9});
  await pilot('start',{acknowledgeCost:true});
  const paused=await until(value=>value.run?.status==='PAUSED');
  expect(paused.run!.reason).toContain('al 95 % (umbral 90 %)');
  expect(paused.tasks.map(task=>task.status)).toEqual(['DONE','READY']);
  await pilot('stop');
 });

 it('marks a pilot left running by a closed app as stopped on the next open',async()=>{
  const {core,projectId,pilot,until,workspaceRoot}=await setup('hang',{tasks:[['t1','TASK-001','READY']],edges:[]});
  await pilot('set_autonomy',{level:'PILOT'});
  await pilot('start',{acknowledgeCost:true});
  await until(value=>value.tasks[0]!.status==='IN_PROGRESS');
  core.close();cores.splice(cores.indexOf(core),1);
  const restarted=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:new PilotAdapter('good')});cores.push(restarted);
  await restarted.handle({channel:'project:open',args:[projectId]});
  const status=await restarted.handle({channel:'pilot:get',args:[projectId,'feat']}) as {run:{status:string;reason:string}};
  expect(status.run).toMatchObject({status:'STOPPED',reason:expect.stringContaining('interrumpido')});
 });
});
