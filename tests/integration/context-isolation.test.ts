import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { RepositoryContextFileStore } from '../../src/infrastructure/filesystem/repository-context-file-store.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentAdapterPort, AgentRunInput } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities, AgentEvent } from '../../src/domain/agents/models.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/** Records every prompt and closes without touching the worktree. */
class RecordingAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;prompts:string[]=[];
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:AgentRunInput):AsyncIterable<AgentEvent>{this.prompts.push(input.prompt);yield {type:'EXECUTION_FINISHED',timestamp:new Date().toISOString(),summary:'**Hecho** Nada.\n**Pendiente** Nada.'};}
 async cancel():Promise<void>{}
 async respondToApproval():Promise<void>{}
}

const git=(repo:string,...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();

async function setup(){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-isolation-'));roots.push(root);
 const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});mkdirSync(join(repo,'docs'),{recursive:true});execFileSync('git',['init','--quiet','-b','main',repo]);
 git(repo,'config','user.name','Graphdev Tests');git(repo,'config','user.email','tests@graphdev.local');
 writeFileSync(join(repo,'src','vault.ts'),'export const vault = "committed";\n');writeFileSync(join(repo,'docs','spec.md'),'# Spec\n\nspec committed\n');
 git(repo,'add','.');git(repo,'commit','--quiet','-m','base');
 const workspaceRoot=join(root,'workspace');const adapter=new RecordingAdapter();
 const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:adapter});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Isolation',slug:'isolation',rules:[]}]}) as {id:string};
 const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
 await core.handle({channel:'repository:configure',args:[project.id,repo]});
 const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
 try{
  const repositoryId=(db.prepare('SELECT id FROM repositories WHERE project_id=?').get(project.id) as {id:string}).id;
  const insert=db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,'now','now')`);
  insert.run('mod',project.id,'MODULE','MOD-001','Bóveda','','DRAFT',opened.selectedEntityId);db.prepare("INSERT INTO modules(entity_id,purpose,module_kind) VALUES('mod','p','FUNCTIONAL')").run();
  insert.run('feat',project.id,'FEATURE','FEAT-001','Bóveda segura','','DRAFT','mod');db.prepare("INSERT INTO features(entity_id,scope,priority) VALUES('feat','s','HIGH')").run();
  for(const [id,key] of [['t1','TASK-001'],['t2','TASK-002']]){insert.run(id,project.id,'WORK_ITEM',key,`Ajustar bóveda ${key}`,'s','READY','feat');db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES(?,'TASK','HIGH','[]','DEVELOPER')`).run(id);}
  insert.run('code',project.id,'CODE_REFERENCE','CODE-001','Código de la bóveda','','DRAFT',null);
  db.prepare(`INSERT INTO code_references(entity_id,repository_id,file_path,symbol_name,symbol_kind,line_start,line_end,commit_sha) VALUES('code',?,'src/vault.ts','vault','CONSTANT',NULL,NULL,'UNCOMMITTED')`).run(repositoryId);
  insert.run('spec',project.id,'ARTIFACT','DOC-001','Especificación de la bóveda','','DRAFT',null);
  db.prepare(`INSERT INTO artifacts(entity_id,repository_id,artifact_type,relative_path,version,content_hash,sync_status) VALUES('spec',?,'SPEC','docs/spec.md',1,?,'SYNCED')`).run(repositoryId,new RepositoryContextFileStore().hashContent('# Spec\n\nspec committed\n'));
  const edge=db.prepare(`INSERT INTO graph_edges(id,project_id,source_id,target_id,edge_type,provenance,changeset_id,execution_id,metadata_json,created_revision,created_at) VALUES(?,?,?,?,?,'USER',NULL,NULL,NULL,1,'now')`);
  edge.run('e1',project.id,'t1','code','TOUCHES_CODE');edge.run('e2',project.id,'t2','code','TOUCHES_CODE');edge.run('e3',project.id,'feat','spec','DOCUMENTED_BY');
 }finally{closeDatabase(db);}
 const profileId=(await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string}>).find(item=>item.roleKey==='DEVELOPER')!.id;
 const run=async(workItemId:string)=>{
  const started=await core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId,profileId}]}) as {id:string};
  for(let attempt=0;attempt<100;attempt+=1){const current=(await core.handle({channel:'execution:list',args:[project.id]}) as Array<{id:string;status:string;initialCommit:string;contextSnapshotId:string|null}>).find(item=>item.id===started.id)!;if(current.status==='COMPLETED')return {execution:current,snapshot:await core.handle({channel:'context:get_snapshot',args:[current.contextSnapshotId]}) as {repositoryCommit:string;includedSources:Array<{sourceId:string;extractedContent:string}>}};if(['FAILED','CANCELLED'].includes(current.status))throw new Error(current.status);await new Promise(resolve=>setTimeout(resolve,30));}
  throw new Error('La ejecución no terminó.');
 };
 return {core,repo,projectId:project.id,adapter,run};
}

describe('execution context comes from its start commit, not from the user checkout',()=>{
 it('ignores uncommitted edits and a different checked-out branch, and pins repositoryCommit to the start point',async()=>{
  const {core,repo,projectId,adapter,run}=await setup();
  const base=git(repo,'rev-parse','HEAD');
  // An uncommitted edit in the user's working copy must not reach the agent.
  writeFileSync(join(repo,'src','vault.ts'),'export const vault = "dirty working copy";\n');
  const first=await run('t1');
  expect(first.execution.initialCommit).toBe(base);
  expect(first.snapshot.repositoryCommit).toBe(base);
  const code=first.snapshot.includedSources.find(source=>source.sourceId==='code')!;
  expect(code.extractedContent).toContain('committed');expect(code.extractedContent).not.toContain('dirty');
  expect(first.snapshot.includedSources.find(source=>source.sourceId==='spec')!.extractedContent).toContain('spec committed');
  expect(adapter.prompts[0]).toContain(`repositoryCommit="${base}"`);
  expect(adapter.prompts[0]).not.toContain('dirty working copy');

  // The user switches to another branch with other committed content: the feature's integration branch still rules.
  git(repo,'checkout','--quiet','-b','experiment');writeFileSync(join(repo,'src','vault.ts'),'export const vault = "other branch";\n');git(repo,'commit','--quiet','-am','experiment');
  writeFileSync(join(repo,'src','vault.ts'),'export const vault = "dirty again";\n');
  const second=await run('t2');
  expect(git(repo,'rev-parse','HEAD')).not.toBe(base);
  expect(second.snapshot.repositoryCommit).toBe(second.execution.initialCommit);
  expect(second.snapshot.repositoryCommit).toBe(base);
  const code2=second.snapshot.includedSources.find(source=>source.sourceId==='code')!.extractedContent;
  expect(code2).toContain('committed');expect(code2).not.toMatch(/other branch|dirty again/);

  // A UI preview (no execution) keeps reflecting the user's checkout, explicitly.
  const preview=await core.handle({channel:'context:preview_package',args:[{projectId,focusEntityId:'t1',sourceCommit:base}]}) as {snapshot:{repositoryCommit:string;includedSources:Array<{sourceId:string;extractedContent:string}>}};
  expect(preview.snapshot.repositoryCommit).toBe(git(repo,'rev-parse','HEAD'));
  expect(preview.snapshot.includedSources.find(source=>source.sourceId==='code')!.extractedContent).toContain('dirty again');
 });
});

describe('RepositoryContextFileStore reads at a commit',()=>{
 it('reads only regular files of that commit, rejects unsafe paths, symlinks and oversized files, and treats a missing file as missing',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-at-commit-'));roots.push(root);const repo=join(root,'repo');mkdirSync(join(repo,'docs'),{recursive:true});
  execFileSync('git',['init','--quiet','-b','main',repo]);git(repo,'config','user.name','T');git(repo,'config','user.email','t@t.local');
  writeFileSync(join(repo,'docs','a.md'),'v1\n');writeFileSync(join(root,'outside.md'),'secret\n');symlinkSync(join(root,'outside.md'),join(repo,'docs','link.md'));
  writeFileSync(join(repo,'big.txt'),'x'.repeat(2*1024*1024+1));
  git(repo,'add','.');git(repo,'commit','--quiet','-m','v1');const commit=git(repo,'rev-parse','HEAD');
  writeFileSync(join(repo,'docs','a.md'),'v2\n');
  const files=new RepositoryContextFileStore();
  expect((await files.readRepositoryFile(repo,'docs/a.md',commit)).content).toBe('v1\n');
  expect((await files.readRepositoryFile(repo,'docs/a.md')).content).toBe('v2\n');
  await expect(files.readRepositoryFile(repo,'docs/link.md',commit)).rejects.toThrow('archivo regular');
  await expect(files.readRepositoryFile(repo,'docs/missing.md',commit)).rejects.toThrow();
  await expect(files.readRepositoryFile(repo,'../outside.md',commit)).rejects.toThrow('relativa y segura');
  await expect(files.readRepositoryFile(repo,'docs/*.md',commit)).rejects.toThrow();
  await expect(files.readRepositoryFile(repo,'big.txt',commit)).rejects.toThrow('demasiado grande');
  await expect(files.readRepositoryFile(repo,'docs/a.md','HEAD')).rejects.toThrow('commit de contexto');
 });
});
