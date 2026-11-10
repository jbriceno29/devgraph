import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync,rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
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
});
