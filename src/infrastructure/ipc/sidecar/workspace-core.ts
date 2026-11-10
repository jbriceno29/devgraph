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
import { ClaudeChangeSetPlanner } from '../../ai/claude-change-set-planner.js';
import type { ChangeSetPlannerPort } from '../../../application/ports/change-set-planning-port.js';
import { SqliteChangeSetRepository } from '../../persistence/repositories/sqlite-change-set-repository.js';
import { SqliteChangeSetApplier } from '../../persistence/sqlite/sqlite-change-set-applier.js';
import { TransactionalMarkdownFileStore } from '../../filesystem/transactional-markdown-file-store.js';
import type { ChangeOperation,ChangeSet } from '../../../domain/knowledge/change-set.js';
import { ContextEngine } from '../../../application/context/context-engine.js';
import { SqliteContextRepository } from '../../persistence/repositories/sqlite-context-repository.js';
import { RepositoryContextFileStore } from '../../filesystem/repository-context-file-store.js';
import type { PreviewContextInput } from '../../../shared/contracts/context-view.js';
import { renderContextSnapshot } from '../../../application/context/context-packager.js';
import { AgentOrchestrator } from '../../../application/execution/agent-orchestrator.js';
import { SqliteAgentExecutionRepository } from '../../persistence/repositories/sqlite-agent-execution-repository.js';
import { ClaudeCodeAdapter } from '../../ai/claude-code-adapter.js';
import { ExecutionEventLog } from '../../filesystem/execution-event-log.js';
import type { AgentExecution } from '../../../domain/agents/models.js';
import type { StartAgentExecutionInput } from '../../../shared/contracts/agent-view.js';
import type { AgentAdapterPort } from '../../../application/ports/agent-adapter-port.js';
import { GitIsolationService } from '../../git/git-isolation-service.js';
import { ExecutionValidator } from '../../execution/execution-validator.js';
export interface WorkspaceRequest { channel:IpcCommandChannel|IpcQueryChannel; args:unknown[] }
export type WorkspaceEventEmitter=(channel:string,payload:unknown)=>void;
export function createWorkspaceCore(workspaceRoot:string,emit:WorkspaceEventEmitter=()=>undefined,dependencies:{agentAdapter?:AgentAdapterPort}={}) {
 const store=new ProjectWorkspaceStore(workspaceRoot);
 const files=new AtomicMarkdownFileStore();
 const watchers=new Map<string,ArtifactWatcherService>();
 // Claude Code is the wired engine; CodexAgentAdapter stays in the codebase, unwired, until Claude is proven (migration plan, section 3).
 const agentAdapter=dependencies.agentAdapter??new ClaudeCodeAdapter();
 const executionServices=new Map<string,AgentOrchestrator>();
 const getManagement=(projectId:string)=>{
  const workspace=store.openProject(projectId);
  return new ArtifactManagementService(workspace.projects,workspace.graph,workspace.artifacts,workspace.repositories,files,event=>emit('artifact:sync_status_changed',event as ArtifactSyncStatusChangedEvent));
 };
 const getPlanning=(projectId:string)=>{
  const workspace=store.openProject(projectId),path=workspace.repositories.findPrimaryForProject(projectId)?.localPath??process.cwd();
  return new ChangeSetPlanningService(workspace.projects,workspace.graph,new SqliteChangeSetRepository(workspace.database),plannerFor(projectId,workspace.database,path),new SqliteChangeSetApplier(workspace.database,new TransactionalMarkdownFileStore(),workspace.repositories),id=>store.openProject(id).repositories.findPrimaryForProject(id)?.localPath??null);
 };
 // The planner follows the wired engine, with the provider's planning model and auth mode.
 const providerConnection=(projectId:string,database:ConstructorParameters<typeof SqliteAgentExecutionRepository>[0])=>new SqliteAgentExecutionRepository(database,agentAdapter.providerId).listProfiles(projectId).find(profile=>profile.roleKey==='DEVELOPER');
 const plannerFor=(projectId:string,database:ConstructorParameters<typeof SqliteAgentExecutionRepository>[0],cwd:string):ChangeSetPlannerPort=>{
  if(agentAdapter.providerId!=='claude-code')return new CodexChangeSetPlanner(cwd);
  const profile=providerConnection(projectId,database);
  return new ClaudeChangeSetPlanner(cwd,{authMode:profile?.connectionConfig.authMode==='api_key'?'api_key':'subscription',defaultModel:profile?.models.planning??null});
 };
 const getContextEngine=(projectId:string)=>{const workspace=store.openProject(projectId);return new ContextEngine(new SqliteContextRepository(workspace.database),new RepositoryContextFileStore());};
 const getExecutionService=(projectId:string)=>{
  const cached=executionServices.get(projectId);if(cached)return cached;
  const workspace=store.openProject(projectId),repository=new SqliteAgentExecutionRepository(workspace.database,agentAdapter.providerId),contextEngine=getContextEngine(projectId);
  const contextBuilder={build:async(input:{projectId:string;focusEntityId:string;repositoryRoot:string;executionId:string})=>contextEngine.preview({projectId:input.projectId,focusEntityId:input.focusEntityId,executionId:input.executionId,maxAllowedTokens:32_000,maxHops:2})};
  const validator=new ExecutionValidator(workspaceRoot,(executionId,repositoryId,diffs)=>repository.recordFileDiffs(executionId,repositoryId,diffs));
  const service=new AgentOrchestrator(repository,contextBuilder,new ExecutionEventLog(workspaceRoot),agentAdapter,new GitIsolationService(),validator,workspaceRoot,(channel,payload)=>emit(channel,payload));
  executionServices.set(projectId,service);return service;
 };
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
     getExecutionService(id).reconcileInterrupted(id);
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
     const model=typeof args[4]==='string'&&args[4].trim()?args[4].trim():undefined;
     if(model){const available=providerConnection(projectId,store.openProject(projectId).database)?.models.available??[];if(!available.includes(model))throw new Error(`El modelo ${model} no está disponible para planificar.`);}
     return getPlanning(projectId).propose(projectId,prompt,focusEntityId,contextPackage,model);
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
    case 'agent:list_profiles': return getExecutionService(String(args[0]??'')).listProfiles(String(args[0]??''));
    case 'execution:list': return getExecutionService(String(args[0]??'')).listExecutions(String(args[0]??'')).map(toAgentExecutionDto);
    case 'execution:list_events': return findExecutionService(String(args[0]??'')).listEvents(String(args[0]??''));
    case 'execution:start': {const input=args[0] as StartAgentExecutionInput;return toAgentExecutionDto(await getExecutionService(input.projectId).start(input));}
    case 'execution:cancel': {const executionId=String(args[0]??'');return toAgentExecutionDto(await findExecutionService(executionId).cancel(executionId));}
    case 'execution:resolve_approval': {const input=args[0] as {executionId:string;requestId:string;decision:import('../../../domain/agents/models.js').ApprovalDecision};await findExecutionService(input.executionId).resolveApproval(input.executionId,input.requestId,input.decision);return {resolved:true};}
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
 function findExecutionService(executionId:string):AgentOrchestrator {
  for(const project of store.listProjects()) {
   const workspace=store.openProject(project.id),repository=new SqliteAgentExecutionRepository(workspace.database);
   if(repository.findExecution(executionId))return getExecutionService(project.id);
  }
  throw new Error('Ejecución no encontrada.');
 }
}
function summarize(project:Project):ProjectSummaryDto{return {id:project.props.id,name:project.props.name,slug:project.props.slug,description:project.props.description??null,currentRevision:project.currentRevision,createdAt:project.props.createdAt,updatedAt:project.props.updatedAt};}
function toDocumentDto(document:import('../../../application/ports/artifact-management-port.js').ArtifactDocumentRecord):ArtifactDocumentDto {return {id:document.id,projectId:document.projectId,displayKey:document.displayKey,title:document.title,summary:document.summary,entityType:document.entityType,artifactType:document.artifactType,version:document.version,adrNumber:document.adrNumber,relativePath:document.relativePath,contentHash:document.contentHash,syncStatus:document.syncStatus};}
function toDocumentViewDto(view:import('../../../application/artifacts/artifact-management-service.js').DocumentView):ArtifactDocumentViewDto{return {document:toDocumentDto(view.document),content:view.content};}
function toAgentExecutionDto(execution:AgentExecution):import('../../../shared/contracts/agent-view.js').AgentExecutionDto{return {id:execution.id,projectId:execution.projectId,workItemId:execution.workItemId,profileId:execution.profileId,providerId:execution.providerId,sessionId:execution.sessionId,contextSnapshotId:execution.contextSnapshotId,status:execution.status,modelUsed:execution.modelUsed,initialCommit:execution.initialCommit,finalCommit:execution.finalCommit,branchOrWorktree:execution.branchOrWorktree,resultSummary:execution.resultSummary,startedAt:execution.startedAt,completedAt:execution.completedAt};}
