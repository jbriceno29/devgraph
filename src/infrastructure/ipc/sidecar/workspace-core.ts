import { ProjectWorkspaceStore } from '../../persistence/sqlite/project-workspace-store.js';
import { GetGraphViewUseCase } from '../../../application/graph/get-graph-view.js';
import { GetEntityInspectorDetailsUseCase } from '../../../application/graph/get-entity-inspector-details.js';
import type { CreateProjectInput, GraphFilterDto, ProjectSummaryDto, WorkspaceLoadedStateDto, IpcCommandChannel, IpcQueryChannel } from '../../../shared/contracts/ipc-contracts.js';
import type { Project } from '../../../domain/projects/project.js';
import { AtomicMarkdownFileStore } from '../../filesystem/atomic-markdown-file-store.js';
import { ArtifactWatcherService } from '../../filesystem/artifact-watcher-service.js';
import { ArtifactManagementService } from '../../../application/artifacts/artifact-management-service.js';
import type { ArtifactSyncStatusChangedEvent } from '../../../application/ports/artifact-management-port.js';
import type { CreateArtifactDocumentInput, ArtifactDocumentDto, ArtifactDocumentViewDto } from '../../../shared/contracts/artifact-view.js';
import { ChangeSetPlanningService } from '../../../application/planning/change-set-planning-service.js';
import { CodexChangeSetPlanner } from '../../ai/codex-change-set-planner.js';
import { SqliteChangeSetRepository } from '../../persistence/repositories/sqlite-change-set-repository.js';
import { SqliteChangeSetApplier } from '../../persistence/sqlite/sqlite-change-set-applier.js';
import { TransactionalMarkdownFileStore } from '../../filesystem/transactional-markdown-file-store.js';
import type { ChangeOperation,ChangeSet } from '../../../domain/knowledge/change-set.js';
import { ContextEngine } from '../../../application/context/context-engine.js';
import { SqliteContextRepository } from '../../persistence/repositories/sqlite-context-repository.js';
import { RepositoryContextFileStore } from '../../filesystem/repository-context-file-store.js';
import type { PreviewContextInput } from '../../../shared/contracts/context-view.js';
import { renderContextSnapshot } from '../../../application/context/context-packager.js';
export interface WorkspaceRequest { channel:IpcCommandChannel|IpcQueryChannel; args:unknown[] }
export type WorkspaceEventEmitter=(channel:'artifact:sync_status_changed'|'graph:revision_updated',payload:ArtifactSyncStatusChangedEvent|{projectId:string;revision:number})=>void;
export function createWorkspaceCore(workspaceRoot:string,emit:WorkspaceEventEmitter=()=>undefined) {
 const store=new ProjectWorkspaceStore(workspaceRoot);
 const files=new AtomicMarkdownFileStore();
 const watchers=new Map<string,ArtifactWatcherService>();
 const getManagement=(projectId:string)=>{
  const workspace=store.openProject(projectId);
  return new ArtifactManagementService(workspace.projects,workspace.graph,workspace.artifacts,workspace.repositories,files,event=>emit('artifact:sync_status_changed',event as ArtifactSyncStatusChangedEvent));
 };
 const getPlanning=(projectId:string)=>{
  const workspace=store.openProject(projectId),path=workspace.repositories.findPrimaryForProject(projectId)?.localPath??process.cwd();
  return new ChangeSetPlanningService(workspace.projects,workspace.graph,new SqliteChangeSetRepository(workspace.database),new CodexChangeSetPlanner(path),new SqliteChangeSetApplier(workspace.database,new TransactionalMarkdownFileStore(),workspace.repositories),id=>store.openProject(id).repositories.findPrimaryForProject(id)?.localPath??null);
 };
 const getContextEngine=(projectId:string)=>{const workspace=store.openProject(projectId);return new ContextEngine(new SqliteContextRepository(workspace.database),new RepositoryContextFileStore());};
 const startWatcher=async(projectId:string)=>{
  const management=getManagement(projectId),repositoryPath=management.repositoryPath(projectId);
  const previous=watchers.get(projectId);previous?.stop();watchers.delete(projectId);
  if(!repositoryPath)return;
  const watcher=new ArtifactWatcherService(projectId,repositoryPath,files,management);
  await watcher.start();watchers.set(projectId,watcher);
 };
 return {
  async handle({channel,args}:WorkspaceRequest):Promise<unknown> {
   switch(channel) {
    case 'project:list': return store.listProjects();
    case 'project:create': {
     const workspace=store.createProject(args[0] as CreateProjectInput);
     const project=workspace.projects.findById(workspace.id)!;
     return summarize(project);
    }
    case 'project:open': {
     const id=String(args[0]??'');const workspace=store.openProject(id);const project=workspace.projects.findById(id)!;
     await startWatcher(id);
     const graph=new GetGraphViewUseCase(workspace.projects,workspace.graph).execute(id);
     const selectedEntityId=graph.nodes.find(node=>node.type==='PROJECT_ROOT')?.id??graph.nodes[0]?.id??'';
     const loaded:WorkspaceLoadedStateDto={project:summarize(project),graph,selectedEntityId};return loaded;
    }
    case 'graph:get_view': {
     const id=String(args[0]??'');const filter=args[1] as GraphFilterDto|undefined;const workspace=store.openProject(id);
     return new GetGraphViewUseCase(workspace.projects,workspace.graph).execute(id,filter);
    }
    case 'entity:get_inspector_details': {
     const id=String(args[0]??'');
     // Resolve ownership from the workspace registry without exposing its database path to the renderer.
     for(const project of store.listProjects()) {
      const workspace=store.openProject(project.id);
      if(workspace.graph.findEntityById(id))return new GetEntityInspectorDetailsUseCase(workspace.graph).execute(id);
     }
     throw new Error(`Entity not found: ${id}`);
    }
    case 'repository:configure': {
     const projectId=String(args[0]??''),localPath=String(args[1]??'');
     const configured=await getManagement(projectId).configureRepository(projectId,localPath);
     await startWatcher(projectId);
     return configured;
    }
    case 'repository:get_path': {
     const projectId=String(args[0]??'');return getManagement(projectId).repositoryPath(projectId);
    }
    case 'artifact:list': {
     const projectId=String(args[0]??'');return getManagement(projectId).list(projectId).map(toDocumentDto);
    }
    case 'artifact:read': {
     const view=await getManagementForDocument(String(args[0]??'')).read(String(args[0]??''));
     return toDocumentViewDto(view);
    }
    case 'artifact:create': {
     const input=args[0] as CreateArtifactDocumentInput;
     const result=await getManagement(input.projectId).create(input);
     const revision=store.openProject(input.projectId).projects.findById(input.projectId)!.currentRevision;
     emit('graph:revision_updated',{projectId:input.projectId,revision});
     return toDocumentViewDto(result);
    }
    case 'artifact:save': {
     const documentId=String(args[0]??''),expectedHash=String(args[1]??''),content=String(args[2]??'');
     const view=await getManagementForDocument(documentId).save(documentId,expectedHash,content);
     return toDocumentViewDto(view);
    }
    case 'changeset:propose_from_chat': {
     const projectId=String(args[0]??''),prompt=String(args[1]??''),focusEntityId=args[2]===undefined?undefined:String(args[2]);
     const snapshotId=args[3]===undefined?undefined:String(args[3]);let contextPackage:string|undefined;
     if(snapshotId){const snapshot=getContextEngine(projectId).getSnapshot(snapshotId);if(snapshot.projectId!==projectId||snapshot.focusEntityId!==focusEntityId)throw new Error('El ContextSnapshot no corresponde al proyecto y foco seleccionados.');const currentRevision=store.openProject(projectId).projects.findById(projectId)!.currentRevision;if(snapshot.graphRevision!==currentRevision)throw new Error('El ContextSnapshot quedó desactualizado; vuelve a preparar el contexto antes de proponer cambios.');contextPackage=renderContextSnapshot(snapshot);}
     return getPlanning(projectId).propose(projectId,prompt,focusEntityId,contextPackage);
    }
    case 'changeset:edit': return getPlanningForChangeSet(String(args[0]??'')).edit(String(args[0]??''),args[1] as ChangeOperation[]);
    case 'changeset:apply': {
     const changeSetId=String(args[0]??''),planning=getPlanningForChangeSet(changeSetId),result=await planning.apply(changeSetId);
     emit('graph:revision_updated',{projectId:result.changeSet.projectId,revision:result.revision});return result;
    }
    case 'changeset:reject': return getPlanningForChangeSet(String(args[0]??'')).reject(String(args[0]??''));
    case 'changeset:list': return getPlanning(String(args[0]??'')).list(String(args[0]??''));
    case 'context:preview_package': {const input=args[0] as PreviewContextInput;return getContextEngine(input.projectId).preview(input);}
    case 'context:get_snapshot': {const snapshotId=String(args[0]??'');for(const project of store.listProjects()){const workspace=store.openProject(project.id),repository=new SqliteContextRepository(workspace.database);if(repository.findSnapshot(snapshotId))return new ContextEngine(repository,new RepositoryContextFileStore()).getSnapshot(snapshotId);}throw new Error('ContextSnapshot no encontrado.');}
    default: throw new Error(`Unsupported workspace IPC channel: ${channel}`);
   }
  },
  close():void {for(const watcher of watchers.values())watcher.stop();watchers.clear();store.closeAll();},
 };
 function getManagementForDocument(documentId:string):ArtifactManagementService {
  for(const project of store.listProjects()) {
   const workspace=store.openProject(project.id);
   if(workspace.artifacts.findDocumentById(documentId))return getManagement(project.id);
  }
  throw new Error(`Document not found: ${documentId}`);
 }
 function getPlanningForChangeSet(changeSetId:string):ChangeSetPlanningService {
  for(const project of store.listProjects()){const workspace=store.openProject(project.id);if(new SqliteChangeSetRepository(workspace.database).findById(changeSetId))return getPlanning(project.id);}
  throw new Error('Propuesta no encontrada.');
 }
}
function summarize(project:Project):ProjectSummaryDto{return {id:project.props.id,name:project.props.name,slug:project.props.slug,description:project.props.description??null,currentRevision:project.currentRevision,createdAt:project.props.createdAt,updatedAt:project.props.updatedAt};}
function toDocumentDto(document:import('../../../application/ports/artifact-management-port.js').ArtifactDocumentRecord):ArtifactDocumentDto {return {id:document.id,projectId:document.projectId,displayKey:document.displayKey,title:document.title,summary:document.summary,entityType:document.entityType,artifactType:document.artifactType,version:document.version,adrNumber:document.adrNumber,relativePath:document.relativePath,contentHash:document.contentHash,syncStatus:document.syncStatus};}
function toDocumentViewDto(view:import('../../../application/artifacts/artifact-management-service.js').DocumentView):ArtifactDocumentViewDto{return {document:toDocumentDto(view.document),content:view.content};}
