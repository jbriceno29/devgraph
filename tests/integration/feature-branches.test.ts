import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/** Follows `WRITE <path> :: <content>` directives from the task summary and records which files each run saw on start. */
class FileAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;seen:Array<{title:string;files:string[]}>=[];
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{
  const title=/# WorkItem\n([^\n]+)/.exec(input.prompt)?.[1]??'';
  const src=join(input.workingDirectory,'src');
  this.seen.push({title,files:existsSync(src)?readdirSync(src).sort():[]});
  const workItem=input.prompt.slice(input.prompt.indexOf('# WorkItem'),input.prompt.indexOf('# Criterios'));
  for(const match of workItem.matchAll(/WRITE (\S+) :: ([^\n]+)/g)){const target=join(input.workingDirectory,match[1]!);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,`${match[2]}\n`);}
  yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary:`**Hecho** ${title}.`};
 }
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

type Spec={features:Array<{id:string;key:string;title:string}>;tasks:Array<{id:string;key:string;feature:string;title:string;summary:string;status?:string}>;edges:Array<[string,string]>};

async function setup(spec:Spec){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-branches-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'});
 git('config','user.name','Graphdev Tests');git('config','user.email','tests@graphdev.local');
 writeFileSync(join(repo,'README.md'),'# repo\n');git('add','.');git('commit','--quiet','-m','scaffold');
 const workspaceRoot=join(root,'workspace');const adapter=new FileAdapter();
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:adapter});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Branches',slug:'branches'}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const withDb=<T,>(work:(db:ReturnType<typeof openDatabase>)=>T):T=>{const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});try{return work(db);}finally{closeDatabase(db);}};
 const addTask=(task:Spec['tasks'][number])=>withDb(db=>{db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,'WORK_ITEM',?,?,?,?,?,1,1,'now','now')`).run(task.id,project.id,task.key,task.title,task.summary,task.status??'READY',task.feature);db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(task.id);});
 withDb(db=>{
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','App','','DRAFT',opened.selectedEntityId);db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  for(const feature of spec.features){insert.run(feature.id,project.id,'FEATURE',feature.key,feature.title,'','DRAFT','mod');db.prepare(`INSERT INTO features(entity_id,scope,priority) VALUES(?,'s','HIGH')`).run(feature.id);}
  for(const task of spec.tasks){insert.run(task.id,project.id,'WORK_ITEM',task.key,task.title,task.summary,task.status??'READY',task.feature);db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(task.id);}
  spec.edges.forEach(([source,target],index)=>db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`).run(`e${index}`,project.id,source,target));
 });
 const profileId=(await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string}>).find(item=>item.roleKey==='DEVELOPER')!.id;
 const start=(workItemId:string)=>core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId,profileId}]}) as Promise<{id:string;status:string;resultSummary:string|null;baseBranch:string|null}>;
 const runAndAccept=async(workItemId:string)=>{
  const started=await start(workItemId);
  for(let attempt=0;attempt<100;attempt+=1){const current=(await core.handle({channel:'execution:list',args:[project.id]}) as Array<{id:string;status:string;resultSummary:string|null}>).find(item=>item.id===started.id)!;if(current.status==='COMPLETED')break;if(['FAILED','CANCELLED'].includes(current.status))throw new Error(`${current.status}: ${current.resultSummary}`);await new Promise(resolve=>setTimeout(resolve,30));}
  const accepted=await core.handle({channel:'execution:accept',args:[started.id]}) as {merged:boolean;execution:{baseBranch:string}};
  expect(accepted.merged).toBe(true);
  return accepted;
 };
 const integrate=(featureId:string)=>core.handle({channel:'feature:integrate',args:[project.id,featureId]}) as Promise<{merged:boolean;alreadyIntegrated:boolean;branchName:string;targetBranch:string;commit:string}>;
 const files=(ref:string)=>git('ls-tree','-r','--name-only',ref).split('\n').filter(Boolean).sort();
 const branches=()=>git('branch','--format=%(refname:short)').split('\n').filter(Boolean).sort();
 const mergeWorktrees=()=>{const directory=join(workspaceRoot,'projects',project.id,'merges');return existsSync(directory)?readdirSync(directory):[];};
 return {core,repo,git,adapter,addTask,projectId:project.id,start,runAndAccept,integrate,files,branches,mergeWorktrees};
}

const twoFeatures=(edges:Array<[string,string]>,extra:Spec['tasks']=[]):Spec=>({
 features:[{id:'fa',key:'FEAT-001',title:'Fundación'},{id:'fb',key:'FEAT-002',title:'Listado'}],
 tasks:[
  {id:'a1',key:'TASK-001',feature:'fa',title:'Crear módulo a',summary:'WRITE src/a.js :: export const a = 1;'},
  {id:'b1',key:'TASK-002',feature:'fb',title:'Usar módulo a',summary:'WRITE src/b.js :: import { a } from "./a.js";'},
  ...extra,
 ],
 edges,
});

describe('feature integration branches',()=>{
 it('(a) starts a dependent feature from the work of the feature it depends on',async()=>{
  const {adapter,runAndAccept,files}=await setup(twoFeatures([['fb','fa']]));
  await runAndAccept('a1');
  const accepted=await runAndAccept('b1');
  expect(adapter.seen.find(run=>run.title==='Usar módulo a')!.files).toEqual(['a.js']);
  expect(files(accepted.execution.baseBranch)).toEqual(['README.md','src/a.js','src/b.js']);
 });

 it('(b) refuses to start while the feature it depends on has pending tasks',async()=>{
  const {start,branches}=await setup(twoFeatures([['fb','fa']],[{id:'a2',key:'TASK-003',feature:'fa',title:'Más de a',summary:'WRITE src/a2.js :: 1'}]));
  await expect(start('b1')).rejects.toThrow('FEAT-002 depende de Fundación, que aún tiene tareas pendientes: TASK-001, TASK-003.');
  expect(branches()).toEqual(['main']);
 });

 it('(b2) the pilot of a blocked feature waits for the user with the reason',async()=>{
  const {core,projectId,branches}=await setup(twoFeatures([['fb','fa']]));
  await core.handle({channel:'pilot:set_autonomy',args:[projectId,'fb',{level:'PILOT'}]});
  await core.handle({channel:'pilot:start',args:[projectId,'fb',{acknowledgeCost:true}]});
  let run:{status:string;reason:string|null}|null=null;
  for(let attempt=0;attempt<100;attempt+=1){run=(await core.handle({channel:'pilot:get',args:[projectId,'fb']}) as {run:{status:string;reason:string|null}}).run;if(run.status!=='RUNNING')break;await new Promise(resolve=>setTimeout(resolve,20));}
  expect(run).toMatchObject({status:'WAITING_USER'});
  expect(run!.reason).toContain('FEAT-002 depende de Fundación, que aún tiene tareas pendientes: TASK-001.');
  expect(branches()).toEqual(['main']);
 });

 it('(c) reports a conflict between dependencies without leaving branches or worktrees behind',async()=>{
  const {start,runAndAccept,branches,mergeWorktrees,git}=await setup({
   features:[{id:'fa',key:'FEAT-001',title:'Uno'},{id:'fc',key:'FEAT-003',title:'Dos'},{id:'fb',key:'FEAT-002',title:'Tres'}],
   tasks:[
    {id:'a1',key:'TASK-001',feature:'fa',title:'Config uno',summary:'WRITE src/config.js :: export const lang = "es";'},
    {id:'c1',key:'TASK-002',feature:'fc',title:'Config dos',summary:'WRITE src/config.js :: export const lang = "en";'},
    {id:'b1',key:'TASK-003',feature:'fb',title:'Usar config',summary:'WRITE src/b.js :: 1'},
   ],
   edges:[['fb','fa'],['fb','fc']],
  });
  await runAndAccept('a1');await runAndAccept('c1');
  const before=branches();
  await expect(start('b1')).rejects.toThrow(/conflicto.*src\/config\.js/i);
  expect(branches()).toEqual(before);
  expect(branches().some(name=>name.startsWith('feature/feat-002'))).toBe(false);
  expect(mergeWorktrees()).toEqual([]);
  expect(git('worktree','list','--porcelain').match(/^worktree /gm)).toHaveLength(1);
 });

 it('(d) independent features still branch from the base',async()=>{
  const {adapter,runAndAccept,files}=await setup(twoFeatures([]));
  await runAndAccept('a1');
  const accepted=await runAndAccept('b1');
  expect(adapter.seen.find(run=>run.title==='Usar módulo a')!.files).toEqual([]);
  expect(files(accepted.execution.baseBranch)).toEqual(['README.md','src/b.js']);
 });

 it('(e) integrates a finished feature into the base branch, refusing pending tasks and a dirty checkout',async()=>{
  const {core,projectId,repo,git,runAndAccept,integrate,files,start,adapter}=await setup(twoFeatures([['fb','fa']],[{id:'a2',key:'TASK-003',feature:'fa',title:'Más de a',summary:'WRITE src/a2.js :: export const a2 = 2;'}]));
  const state=async()=>({pilot:(await core.handle({channel:'pilot:get',args:[projectId,'fa']}) as {integration?:unknown}).integration,inspector:(await core.handle({channel:'entity:get_inspector_details',args:['fa']}) as {integration?:unknown}).integration,activity:(await core.handle({channel:'activity:list',args:[projectId]}) as {integrations?:Array<{featureId:string}>}).integrations?.find(item=>item.featureId==='fa')});
  await runAndAccept('a1');
  // Cheap integration state (no git): branch, base branch and open tasks, in the pilot panel, the inspector and the activity.
  expect(await state()).toEqual({pilot:{branchName:'feature/feat-001-fundacion',targetBranch:'main',integratedAt:null,taskCount:2,openTaskCount:1},inspector:{branchName:'feature/feat-001-fundacion',targetBranch:'main',integratedAt:null,taskCount:2,openTaskCount:1},activity:{featureId:'fa',branchName:'feature/feat-001-fundacion',targetBranch:'main',integratedAt:null}});
  await expect(integrate('fa')).rejects.toThrow('FEAT-001 aún tiene tareas pendientes: TASK-003.');
  await runAndAccept('a2');
  writeFileSync(join(repo,'README.md'),'# cambio local\n');
  await expect(integrate('fa')).rejects.toThrow(/cambios sin commitear/);
  expect(files('main')).toEqual(['README.md']);
  git('checkout','--quiet','--','README.md');
  const result=await integrate('fa');
  expect(result).toMatchObject({merged:true,alreadyIntegrated:false,targetBranch:'main'});
  expect(files('main')).toEqual(['README.md','src/a.js','src/a2.js']);
  // The user's checkout (on main, clean) follows the branch; the feature branch is kept.
  expect(existsSync(join(repo,'src','a.js'))).toBe(true);
  expect(git('branch','--format=%(refname:short)')).toContain(result.branchName);
  const integrated=await state();
  expect(integrated.pilot).toMatchObject({openTaskCount:0,integratedAt:expect.any(String)});expect(integrated.activity).toMatchObject({integratedAt:expect.any(String)});
  expect(await integrate('fa')).toMatchObject({merged:false,alreadyIntegrated:true});
  // A dependent feature started now finds A's work in the base: no second merge of A's branch.
  await start('b1');
  for(let attempt=0;attempt<100&&!adapter.seen.some(run=>run.title==='Usar módulo a');attempt+=1)await new Promise(resolve=>setTimeout(resolve,30));
  expect(adapter.seen.find(run=>run.title==='Usar módulo a')!.files).toEqual(['a.js','a2.js']);
  expect(git('log','--merges','--format=%s','feature/feat-002-listado')).not.toContain('Incorpora');
 });

 it('(e2) integrates into the base branch when it is not checked out, without touching the checkout',async()=>{
  const {core,projectId,addTask,git,runAndAccept,integrate,files}=await setup(twoFeatures([]));
  await runAndAccept('a1');
  git('checkout','--quiet','-b','otra');
  await expect(integrate('fa')).resolves.toMatchObject({merged:true,targetBranch:'main'});
  // New work accepted on the feature branch clears the «integrated» mark, so the next step offers it again.
  const mark=async()=>(await core.handle({channel:'pilot:get',args:[projectId,'fa']}) as {integration:{integratedAt:string|null}}).integration.integratedAt;
  expect(await mark()).toEqual(expect.any(String));
  addTask({id:'a3',key:'TASK-009',feature:'fa',title:'Más',summary:'WRITE src/a3.js :: export const a3 = 3;'});await runAndAccept('a3');
  expect(await mark()).toBeNull();
  expect(files('main')).toContain('src/a.js');
  expect(git('symbolic-ref','--short','HEAD').trim()).toBe('otra');
  expect(files('otra')).toEqual(['README.md']);
 });

 it('(f) treats a task-to-task dependency across features as a feature dependency',async()=>{
  const {adapter,start,runAndAccept,files}=await setup(twoFeatures([['b1','a1']],[{id:'a2',key:'TASK-003',feature:'fa',title:'Más de a',summary:'WRITE src/a2.js :: 2'}]));
  await runAndAccept('a1');
  // b1's own dependency is DONE, but its feature still waits for the rest of FEAT-001.
  await expect(start('b1')).rejects.toThrow('FEAT-002 depende de Fundación, que aún tiene tareas pendientes: TASK-003.');
  await runAndAccept('a2');
  const accepted=await runAndAccept('b1');
  expect(adapter.seen.find(run=>run.title==='Usar módulo a')!.files).toEqual(['a.js','a2.js']);
  expect(files(accepted.execution.baseBranch)).toEqual(['README.md','src/a.js','src/a2.js','src/b.js']);
 });

 it('syncs an already started feature with work its dependency received later',async()=>{
  const {adapter,runAndAccept,files,addTask}=await setup(twoFeatures([['fb','fa']],[{id:'b2',key:'TASK-004',feature:'fb',title:'Segunda de b',summary:'WRITE src/b2.js :: 2'}]));
  await runAndAccept('a1');
  await runAndAccept('b1');
  // A new task appears in FEAT-001 after FEAT-002 started (e.g. an approved plan change) and is finished.
  addTask({id:'a2',key:'TASK-005',feature:'fa',title:'Más de a',summary:'WRITE src/a2.js :: 2'});
  await runAndAccept('a2');
  const accepted=await runAndAccept('b2');
  expect(adapter.seen.find(run=>run.title==='Segunda de b')!.files).toEqual(['a.js','a2.js','b.js']);
  expect(files(accepted.execution.baseBranch)).toEqual(['README.md','src/a.js','src/a2.js','src/b.js','src/b2.js']);
 });
});
