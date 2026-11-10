import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { GitIsolationService } from '../../src/infrastructure/git/git-isolation-service.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

class HangingAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run():AsyncIterable<AgentEvent>{yield {type:'SESSION_INITIALIZED',timestamp:new Date().toISOString(),externalSessionId:'session'};await new Promise(()=>undefined);}
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

function gitRepository(root:string):string{
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet',repo]);
 execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
 writeFileSync(join(repo,'src','base.txt'),'base\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});return repo;
}

async function projectWithReadyTask(workspaceRoot:string,repo:string){
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:new HangingAdapter()});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Recovery',slug:'recovery'}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES('task-1',?,'WORK_ITEM','TASK-001','Task','Summary','READY',?,1,1,'now','now')`).run(project.id,opened.selectedEntityId);
  db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES('task-1','TASK','HIGH','[]','DEVELOPER')`).run();
 }finally{closeDatabase(db);}
 const profiles=await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string}>;
 return {core,projectId:project.id,profileId:profiles.find(item=>item.roleKey==='DEVELOPER')!.id};
}

describe('execution recovery after a sidecar restart (D4)',()=>{
 it('marks the interrupted execution FAILED on project:open and lets the task run again',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-recovery-'));roots.push(root);const repo=gitRepository(root),workspaceRoot=join(root,'workspace');
  const {core,projectId,profileId}=await projectWithReadyTask(workspaceRoot,repo);
  const first=await core.handle({channel:'execution:start',args:[{projectId,workItemId:'task-1',profileId}]}) as {id:string;status:string};
  expect(first.status).toBe('RUNNING');
  core.close();cores.splice(cores.indexOf(core),1);

  const restarted=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:new HangingAdapter()});cores.push(restarted);
  await restarted.handle({channel:'project:open',args:[projectId]});
  const executions=await restarted.handle({channel:'execution:list',args:[projectId]}) as Array<{id:string;status:string;resultSummary:string|null}>;
  expect(executions.find(item=>item.id===first.id)).toMatchObject({status:'FAILED',resultSummary:expect.stringContaining('interrumpida')});
  const events=await restarted.handle({channel:'execution:list_events',args:[first.id]}) as Array<{event:AgentEvent}>;
  expect(events.at(-1)!.event).toMatchObject({type:'EXECUTION_FAILED',errorCode:'EXECUTION_INTERRUPTED'});
  const second=await restarted.handle({channel:'execution:start',args:[{projectId,workItemId:'task-1',profileId}]}) as {status:string};
  expect(second.status).toBe('RUNNING');
 });

 it('cancels an interrupted execution that has not been reconciled yet',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-recovery-'));roots.push(root);const repo=gitRepository(root),workspaceRoot=join(root,'workspace');
  const {core,projectId,profileId}=await projectWithReadyTask(workspaceRoot,repo);
  const first=await core.handle({channel:'execution:start',args:[{projectId,workItemId:'task-1',profileId}]}) as {id:string};
  core.close();cores.splice(cores.indexOf(core),1);
  const restarted=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:new HangingAdapter()});cores.push(restarted);
  const cancelled=await restarted.handle({channel:'execution:cancel',args:[first.id]}) as {status:string};
  expect(cancelled.status).toBe('CANCELLED');
 });
});

describe('GitIsolationService.discard',()=>{
 const projectId='11111111-1111-4111-8111-111111111111',executionId='22222222-2222-4222-8222-222222222222';
 it('removes the worktree and its graphdev branch',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-discard-'));roots.push(root);const repo=gitRepository(root),workspaceRoot=join(root,'workspace');
  const service=new GitIsolationService();
  const isolated=await service.prepare({projectId,executionId,workItemKey:'TASK-001',repositoryRoot:repo,workspaceRoot,requireWorktree:true});
  expect(existsSync(isolated.workingDirectory)).toBe(true);
  await service.discard({repositoryRoot:repo,workspaceRoot,workingDirectory:isolated.workingDirectory,branchName:isolated.branchName});
  expect(existsSync(isolated.workingDirectory)).toBe(false);
  expect(execFileSync('git',['branch','--list',isolated.branchName],{cwd:repo,encoding:'utf8'}).trim()).toBe('');
  expect(execFileSync('git',['worktree','list','--porcelain'],{cwd:repo,encoding:'utf8'})).not.toContain(executionId);
 });

 it('refuses paths and branches it did not create',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-discard-'));roots.push(root);const repo=gitRepository(root),workspaceRoot=join(root,'workspace');
  const service=new GitIsolationService();
  await expect(service.discard({repositoryRoot:repo,workspaceRoot,workingDirectory:repo,branchName:'graphdev/x'})).rejects.toThrow('did not create');
  await expect(service.discard({repositoryRoot:repo,workspaceRoot,workingDirectory:join(workspaceRoot,'projects',projectId,'worktrees',executionId),branchName:'main'})).rejects.toThrow('did not create');
  expect(existsSync(join(repo,'src','base.txt'))).toBe(true);
 });
});
