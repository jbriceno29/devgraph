import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/**
 * Follows `WRITE <path> :: <content>` directives: the one in the task summary, or — on a revision — the one in the
 * reviewer's feedback. Enough to exercise merges and conflicts with real Git.
 */
class DirectiveAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{
  const section=input.prompt.includes('# Ajustes solicitados')?input.prompt.slice(input.prompt.indexOf('# Ajustes solicitados'),input.prompt.indexOf('# Política de ejecución')):input.prompt;
  const match=/WRITE (\S+) :: (.+)/.exec(section);
  if(match){const target=join(input.workingDirectory,match[1]!);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,`${match[2]}\n`);}
  yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary:match?`Wrote ${match[1]}`:'Nothing to do'};
 }
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

async function setup(tasks:Array<{id:string;key:string;title:string;summary:string;status:string}>,edges:Array<[string,string]>=[]){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-review-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
 writeFileSync(join(repo,'src','base.ts'),'export const base = 1;\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});
 const workspaceRoot=join(root,'workspace');
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:new DirectiveAdapter()});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Review',slug:'review'}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','Tareas','','DRAFT',opened.selectedEntityId);
  db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  insert.run('feat',project.id,'FEATURE','FEAT-001','Gestión de tareas','','DRAFT','mod');
  db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
  for(const task of tasks){insert.run(task.id,project.id,'WORK_ITEM',task.key,task.title,task.summary,task.status,'feat');db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(task.id);}
  edges.forEach(([source,target],index)=>db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,'DEPENDS_ON','USER',NULL,NULL,NULL,1,'now')`).run(`e${index}`,project.id,source,target));
 }finally{closeDatabase(db);}
 const profileId=(await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string}>).find(item=>item.roleKey==='DEVELOPER')!.id;
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 const status=async(id:string)=>(await core.handle({channel:'graph:get_view',args:[project.id]}) as {nodes:Array<{id:string;status:string}>}).nodes.find(node=>node.id===id)!.status;
 const run=async(input:{workItemId:string}|{executionId:string;feedback:string})=>{
  const started=('feedback' in input
   ?await core.handle({channel:'execution:request_changes',args:[input]})
   :await core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId:input.workItemId,profileId}]})) as {id:string};
  for(let attempt=0;attempt<100;attempt+=1){
   const current=(await core.handle({channel:'execution:list',args:[project.id]}) as Array<{id:string;status:string}>).find(item=>item.id===started.id)!;
   if(['COMPLETED','FAILED','CANCELLED'].includes(current.status)){expect(current.status).toBe('COMPLETED');return current as unknown as {id:string;baseBranch:string;branchOrWorktree:string;finalCommit:string};}
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw new Error('run did not finish');
 };
 return {core,repo,git,status,run};
}

describe('review: request changes and accept through the workspace core (Stage 1.2)',()=>{
 it('adjusts a run, squash-merges both rounds into the feature branch, marks DONE and unblocks the dependent',async()=>{
  const {core,git,status,run}=await setup([
   {id:'t1',key:'TASK-001',title:'Crear tareas',summary:'WRITE src/tasks.ts :: export const tasks = [];',status:'READY'},
   {id:'t2',key:'TASK-002',title:'Listar tareas',summary:'WRITE src/list.ts :: export const list = 1;',status:'BLOCKED'},
  ],[['t2','t1']]);
  const first=await run({workItemId:'t1'});
  expect(first.baseBranch).toBe('feature/feat-001-gestion-de-tareas');
  expect(await status('t1')).toBe('IN_REVIEW');

  const detail=await core.handle({channel:'execution:get_detail',args:[first.id]}) as {files:Array<{path:string;changeType:string;patch:string}>;canAccept:boolean;canRequestChanges:boolean;testLog:string|null};
  expect(detail.files).toEqual([expect.objectContaining({path:'src/tasks.ts',changeType:'ADDED'})]);
  expect(detail.files[0]!.patch).toContain('export const tasks');
  expect(detail).toMatchObject({canAccept:true,canRequestChanges:true});expect(detail.testLog).toContain('No verification commands');

  const second=await run({executionId:first.id,feedback:'WRITE src/validate.ts :: export const validate = true;'});
  expect(second.baseBranch).toBe('feature/feat-001-gestion-de-tareas');
  expect(existsSync(first.branchOrWorktree)).toBe(false);
  expect(git('cat-file','-t',first.finalCommit)).toBe('commit');

  const accepted=await core.handle({channel:'execution:accept',args:[second.id]}) as {merged:boolean;execution:{reviewStatus:string;mergedCommit:string;branchOrWorktree:string|null}};
  expect(accepted).toMatchObject({merged:true,execution:{reviewStatus:'ACCEPTED',branchOrWorktree:null}});
  expect(git('log','--format=%s','main..feature/feat-001-gestion-de-tareas').split('\n')).toEqual(['TASK-001: Crear tareas']);
  expect(git('show','--name-only','--format=','feature/feat-001-gestion-de-tareas').split('\n').sort()).toEqual(['src/tasks.ts','src/validate.ts']);
  expect(git('rev-parse','feature/feat-001-gestion-de-tareas')).toBe(accepted.execution.mergedCommit);
  expect(await status('t1')).toBe('DONE');
  expect(await status('t2')).toBe('READY');
  expect(git('branch','--show-current')).toBe('main');expect(git('status','--porcelain')).toBe('');
  expect(git('branch','--list','graphdev/*')).toBe('');
  expect(git('worktree','list').split('\n')).toHaveLength(1);

  const next=await run({workItemId:'t2'});
  expect(git('ls-tree','--name-only','-r',next.finalCommit,'src').split('\n').sort()).toEqual(['src/base.ts','src/list.ts','src/tasks.ts','src/validate.ts']);
 });

 it('records a merge conflict and leaves the task in review',async()=>{
  const {core,git,status,run}=await setup([
   {id:'t1',key:'TASK-001',title:'Uno',summary:'WRITE src/base.ts :: export const base = "uno";',status:'READY'},
   {id:'t2',key:'TASK-002',title:'Dos',summary:'WRITE src/base.ts :: export const base = "dos";',status:'READY'},
  ]);
  const one=await run({workItemId:'t1'});const two=await run({workItemId:'t2'});
  expect((await core.handle({channel:'execution:accept',args:[one.id]}) as {merged:boolean}).merged).toBe(true);
  const conflicted=await core.handle({channel:'execution:accept',args:[two.id]}) as {merged:boolean;conflict:{reason:string;files:string[]};execution:{reviewStatus:string}};
  expect(conflicted).toMatchObject({merged:false,conflict:{reason:'CONFLICT',files:['src/base.ts']},execution:{reviewStatus:'MERGE_CONFLICT'}});
  expect(await status('t2')).toBe('IN_REVIEW');
  expect(git('show','feature/feat-001-gestion-de-tareas:src/base.ts')).toBe('export const base = "uno";');
  expect(git('worktree','list').split('\n')).toHaveLength(2);
 });

 it('refuses to integrate into a branch the user has checked out',async()=>{
  const {core,git,status,run}=await setup([{id:'t1',key:'TASK-001',title:'Uno',summary:'WRITE src/one.ts :: export const one = 1;',status:'READY'}]);
  const one=await run({workItemId:'t1'});
  git('checkout','--quiet','feature/feat-001-gestion-de-tareas');
  const refused=await core.handle({channel:'execution:accept',args:[one.id]}) as {merged:boolean;conflict:{reason:string;detail:string}};
  expect(refused).toMatchObject({merged:false,conflict:{reason:'CHECKED_OUT'}});
  expect(await status('t1')).toBe('IN_REVIEW');
  git('checkout','--quiet','main');
  expect((await core.handle({channel:'execution:accept',args:[one.id]}) as {merged:boolean}).merged).toBe(true);
 });
});
