import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync,rmSync,readFileSync,existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import type { AgentAdapterPort } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentCapabilities,AgentEvent } from '../../src/domain/agents/models.js';
import { openDatabase,closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('Tauri to TypeScript sidecar protocol',()=>{
 it('creates and opens a project through the same typed workspace commands',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-core-'));roots.push(root);const core=createWorkspaceCore(root);cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Tauri Bridge',slug:'tauri-bridge'}]}) as {id:string;currentRevision:number};
  expect(project.id).toMatch(/^[a-f0-9-]{36}$/i);expect(project.currentRevision).toBe(1);
  const opened=await core.handle({channel:'project:open',args:[project.id]}) as {project:{id:string};graph:{nodes:Array<{id:string;key:string;type:string}>};selectedEntityId:string};
  expect(opened.project.id).toBe(project.id);expect(opened.graph.nodes).toHaveLength(1);expect(opened.graph.nodes[0]).toMatchObject({key:'PROJ-01',type:'PROJECT_ROOT'});expect(opened.selectedEntityId).toBe(opened.graph.nodes[0]!.id);
  const details=await core.handle({channel:'entity:get_inspector_details',args:[opened.selectedEntityId]}) as {entity:{key:string;label:string}};
  expect(details.entity).toMatchObject({key:'PROJ-01',label:'Tauri Bridge'});
 });
 it('rejects unknown channels explicitly',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-core-'));roots.push(root);const core=createWorkspaceCore(root);cores.push(core);
  await expect(core.handle({channel:'unknown:command' as never,args:[]})).rejects.toThrow('Unsupported workspace IPC channel');
 });
 it('previews and persists an immutable ContextSnapshot through the context IPC query',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-context-core-'));roots.push(root);const core=createWorkspaceCore(root);cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Context Bridge',slug:'context-bridge',rules:['Never expose credentials.']}]}) as {id:string};
  const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
  const preview=await core.handle({channel:'context:preview_package',args:[{projectId:project.id,focusEntityId:opened.selectedEntityId,maxAllowedTokens:64}]}) as {snapshot:{id:string;graphRevision:number;includedSources:Array<{authorityTier:number;sourceType:string}>};packageText:string};
  expect(preview.snapshot.graphRevision).toBe(1);expect(preview.snapshot.includedSources).toContainEqual(expect.objectContaining({authorityTier:1,sourceType:'POLICY'}));expect(preview.packageText).toContain('Never expose credentials.');
  const saved=await core.handle({channel:'context:get_snapshot',args:[preview.snapshot.id]}) as {id:string;includedSources:Array<{sourceType:string}>};expect(saved.id).toBe(preview.snapshot.id);expect(saved.includedSources).toEqual(preview.snapshot.includedSources);
 });
 it('routes repository and artifact operations and emits a graph revision after creation',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-documents-'));roots.push(root);const repository=join(root,'repo');mkdirSync(repository);execFileSync('git',['init','--quiet',repository]);
  const events:Array<{channel:string;payload:unknown}>=[];const core=createWorkspaceCore(join(root,'workspace'),(channel,payload)=>events.push({channel,payload}));cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Documents',slug:'documents'}]}) as {id:string};
  const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
  await core.handle({channel:'repository:configure',args:[project.id,repository]});
  const created=await core.handle({channel:'artifact:create',args:[{projectId:project.id,entityType:'ARTIFACT',title:'Product requirements',artifactType:'PRD',targetEntityId:opened.selectedEntityId}]}) as {document:{id:string;relativePath:string;syncStatus:string};content:string};
  expect(created.document).toMatchObject({relativePath:'docs/PRD.md',syncStatus:'SYNCED'});
  expect(await core.handle({channel:'artifact:list',args:[project.id]})).toEqual([expect.objectContaining({id:created.document.id})]);
  const loaded=await core.handle({channel:'artifact:read',args:[created.document.id]}) as {content:string;document:{contentHash:string}};
  expect(loaded.content).toBe(created.content);
  const saved=await core.handle({channel:'artifact:save',args:[created.document.id,loaded.document.contentHash,'# Product requirements\n\nSaved through IPC.']}) as {document:{syncStatus:string}};
  expect(saved.document.syncStatus).toBe('SYNCED');
  expect(events).toContainEqual({channel:'graph:revision_updated',payload:{projectId:project.id,revision:2}});
 });
 it('runs a READY work item with the sealed context and persists live events to SQLite and JSONL',async()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-agent-core-'));roots.push(root);const repositoryPath=join(root,'repo');mkdirSync(join(repositoryPath,'src'),{recursive:true});execFileSync('git',['init','--quiet',repositoryPath]);
  const emitted:Array<{channel:string;payload:unknown}>=[],adapter=new FakeAgentAdapter();const workspaceRoot=join(root,'workspace');const core=createWorkspaceCore(workspaceRoot,(channel,payload)=>emitted.push({channel,payload}),{agentAdapter:adapter});cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Agent Bridge',slug:'agent-bridge',rules:['Keep changes scoped.']}]}) as {id:string};
  const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};await core.handle({channel:'repository:configure',args:[project.id,repositoryPath]});
  const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
  try {
   db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES('task-agent',?,'WORK_ITEM','TASK-001','Implement agent bridge','Add an event stream','READY',?,1,1,'now','now')`).run(project.id,opened.selectedEntityId);
   db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES('task-agent','TASK','HIGH','["Persists its event stream"]','DEVELOPER')`).run();
  } finally { closeDatabase(db); }
  const profiles=await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string;capabilities:AgentCapabilities}>;const developer=profiles.find(item=>item.roleKey==='DEVELOPER')!;expect(developer.capabilities).toMatchObject({supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true});
  const initial=await core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId:'task-agent',profileId:developer.id}]}) as {id:string;status:string;contextSnapshotId:string|null};expect(initial.status).toBe('RUNNING');expect(initial.contextSnapshotId).toBeTruthy();
  const completed=await waitForCompleted(core,project.id,initial.id);expect(completed.status).toBe('COMPLETED');expect(completed.resultSummary).toBe('Implementation finished.');
  const records=await core.handle({channel:'execution:list_events',args:[initial.id]}) as Array<{event:AgentEvent;sequenceNo:number}>;expect(records.map(record=>record.event.type)).toEqual(['SESSION_INITIALIZED','TOOL_INVOCATION_STARTED','TOOL_INVOCATION_FINISHED','FILE_TOUCHED','TEXT_DELTA','EXECUTION_FINISHED']);expect(records.map(record=>record.sequenceNo)).toEqual([1,2,3,4,5,6]);
  const context=await core.handle({channel:'context:get_snapshot',args:[initial.contextSnapshotId]}) as {executionId:string|null;focusEntityId:string};expect(context).toMatchObject({executionId:initial.id,focusEntityId:'task-agent'});
  const eventFile=join(workspaceRoot,'projects',project.id,'executions',initial.id,'events.jsonl');expect(existsSync(eventFile)).toBe(true);expect(readFileSync(eventFile,'utf8').trim().split('\n')).toHaveLength(6);
  expect(emitted.some(event=>event.channel==='execution:status_changed'&&(event.payload as {status?:string}).status==='COMPLETED')).toBe(true);expect(emitted.some(event=>event.channel==='execution:event_received')).toBe(true);expect(existsSync(join(repositoryPath,'src','agent-output.txt'))).toBe(true);
 });
});

class FakeAgentAdapter implements AgentAdapterPort {
 readonly providerId='codex' as const;
 getCapabilities():AgentCapabilities{return {supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};}
 async *run(input:{executionId:string;workingDirectory:string;prompt:string}):AsyncIterable<AgentEvent>{
  await import('node:fs/promises').then(fs=>fs.writeFile(join(input.workingDirectory,'src','agent-output.txt'),input.prompt.includes('ContextSnapshot')?'Context received.':'Missing context.'));
  const timestamp=new Date().toISOString();yield {type:'SESSION_INITIALIZED',timestamp,externalSessionId:'fake-session'};yield {type:'TOOL_INVOCATION_STARTED',timestamp,callId:'call-1',toolName:'write_file',args:{path:'src/agent-output.txt'}};yield {type:'TOOL_INVOCATION_FINISHED',timestamp,callId:'call-1',resultPreview:'File written.',isError:false};yield {type:'FILE_TOUCHED',timestamp,relativePath:'src/agent-output.txt',operation:'CREATE'};yield {type:'TEXT_DELTA',timestamp,delta:'Implementation finished.'};yield {type:'EXECUTION_FINISHED',timestamp,summary:'Implementation finished.'};
 }
 async cancel():Promise<void>{}
}

async function waitForCompleted(core:ReturnType<typeof createWorkspaceCore>,projectId:string,executionId:string):Promise<{status:string;resultSummary:string|null}>{
 for(let attempt=0;attempt<100;attempt++){const executions=await core.handle({channel:'execution:list',args:[projectId]}) as Array<{id:string;status:string;resultSummary:string|null}>;const execution=executions.find(item=>item.id===executionId);if(execution?.status==='COMPLETED'||execution?.status==='FAILED'||execution?.status==='CANCELLED')return execution;await new Promise(resolve=>setTimeout(resolve,10));}
 throw new Error(`Execution ${executionId} did not finish in time.`);
}
