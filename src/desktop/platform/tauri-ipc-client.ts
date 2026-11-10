import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { WorkspaceIpcClient, WorkspaceIpcEvents } from '../../shared/contracts/ipc-contracts.js';
const invokeCore=<T>(channel:string,args:unknown[]=[]):Promise<T>=>invoke<T>('workspace_request',{request:{channel,args}});
export const workspaceIpc:WorkspaceIpcClient={
 commands:{
  createProject:input=>invokeCore('project:create',[input]),
  openProject:projectId=>invokeCore('project:open',[projectId]),
  configureRepository:(projectId,localPath)=>invokeCore('repository:configure',[projectId,localPath]),
  createArtifact:input=>invokeCore('artifact:create',[input]),
  saveArtifact:(documentId,expectedContentHash,content)=>invokeCore('artifact:save',[documentId,expectedContentHash,content]),
  proposeChanges:(projectId,prompt,focusEntityId,contextSnapshotId)=>invokeCore('changeset:propose_from_chat',[projectId,prompt,focusEntityId,contextSnapshotId]),
  editChangeSet:(changeSetId,operations)=>invokeCore('changeset:edit',[changeSetId,operations]),
  applyChangeSet:changeSetId=>invokeCore('changeset:apply',[changeSetId]),
  rejectChangeSet:changeSetId=>invokeCore('changeset:reject',[changeSetId]),
 },
 queries:{
  listProjects:()=>invokeCore('project:list'),
  getGraphView:(projectId,filter)=>invokeCore('graph:get_view',[projectId,filter]),
  getEntityInspectorDetails:entityId=>invokeCore('entity:get_inspector_details',[entityId]),
  getRepositoryPath:projectId=>invokeCore('repository:get_path',[projectId]),
  listArtifacts:projectId=>invokeCore('artifact:list',[projectId]),
  getArtifact:documentId=>invokeCore('artifact:read',[documentId]),
  listChangeSets:projectId=>invokeCore('changeset:list',[projectId]),
  getContextSnapshot:snapshotId=>invokeCore('context:get_snapshot',[snapshotId]),
  previewContext:input=>invokeCore('context:preview_package',[input]),
 },
 events:{
  onGraphRevisionUpdated(listener){return subscribe('graph:revision_updated',listener);},
  onArtifactSyncStatusChanged(listener){return subscribe('artifact:sync_status_changed',listener);},
 },
};
function subscribe<K extends keyof WorkspaceIpcEvents>(channel:K,listener:(event:WorkspaceIpcEvents[K])=>void):()=>void {
 let unlisten:(()=>void)|undefined;let cancelled=false;
 void listen<WorkspaceIpcEvents[K]>(channel,event=>listener(event.payload)).then(stop=>{if(cancelled)stop();else unlisten=stop;});
 return ()=>{cancelled=true;unlisten?.();};
}
