import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manualWorkItemTransitions, type WorkItemStatus } from '../../../domain/work-management/entities.js';
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
import { normalizeOperation } from '../../ai/change-set-planning-contract.js';
import type { PlanProposalPort } from '../../../application/ports/plan-proposal-port.js';
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
import { coveredWorkItems } from '../../../domain/agents/models.js';
import type { StartAgentExecutionInput } from '../../../shared/contracts/agent-view.js';
import type { AgentAdapterPort } from '../../../application/ports/agent-adapter-port.js';
import { GitIsolationService } from '../../git/git-isolation-service.js';
import { GitDocumentCommitter } from '../../git/git-document-committer.js';
import { ExecutionValidator } from '../../execution/execution-validator.js';
import { FeaturePilot } from '../../../application/execution/feature-pilot.js';
import { FeatureMetrics, renderFeatureReport } from '../../../application/execution/feature-metrics.js';
import { SqlitePilotRepository } from '../../persistence/repositories/sqlite-pilot-repository.js';
import { SqliteActivityRepository } from '../../persistence/repositories/sqlite-activity-repository.js';
import { ActivityService } from '../../../application/activity/activity-service.js';
import { ProjectInceptionService } from '../../../application/inception/project-inception-service.js';
import type { InceptionEnginePort, ReferenceTranslatorPort } from '../../../application/ports/inception-port.js';
import { InceptionReferenceFiles } from '../../filesystem/inception-reference-files.js';
import { ClaudeReferenceTranslator } from '../../ai/claude-reference-translator.js';
import { SqliteInceptionRepository } from '../../persistence/repositories/sqlite-inception-repository.js';
import { ClaudeInceptionEngine } from '../../ai/claude-inception-engine.js';
import { GitRepositoryInitializer } from '../../git/git-repository-initializer.js';
import type { InceptionAnswerDto, StartInceptionInput } from '../../../shared/contracts/inception-view.js';
export interface WorkspaceRequest { channel:IpcCommandChannel|IpcQueryChannel; args:unknown[] }
export type WorkspaceEventEmitter=(channel:string,payload:unknown)=>void;
export function createWorkspaceCore(workspaceRoot:string,emit:WorkspaceEventEmitter=()=>undefined,dependencies:{agentAdapter?:AgentAdapterPort;inceptionEngine?:InceptionEnginePort;referenceTranslator?:ReferenceTranslatorPort}={}) {
 const store=new ProjectWorkspaceStore(workspaceRoot);
 const files=new AtomicMarkdownFileStore();
 const documentCommitter=new GitDocumentCommitter();
 const watchers=new Map<string,ArtifactWatcherService>();
 // Claude Code is the wired engine; CodexAgentAdapter stays in the codebase, unwired, until Claude is proven (migration plan, section 3).
 const agentAdapter=dependencies.agentAdapter??new ClaudeCodeAdapter();
 const executionServices=new Map<string,AgentOrchestrator>();
 const pilots=new Map<string,FeaturePilot>();
 const getManagement=(projectId:string)=>{
  const workspace=store.openProject(projectId);
  return new ArtifactManagementService(workspace.projects,workspace.graph,workspace.artifacts,workspace.repositories,files,event=>emit('artifact:sync_status_changed',event as ArtifactSyncStatusChangedEvent),documentCommitter);
 };
 const getPlanning=(projectId:string)=>{
  const workspace=store.openProject(projectId),path=workspace.repositories.findPrimaryForProject(projectId)?.localPath??process.cwd();
  return new ChangeSetPlanningService(workspace.projects,workspace.graph,new SqliteChangeSetRepository(workspace.database),plannerFor(projectId,workspace.database,path),new SqliteChangeSetApplier(workspace.database,new TransactionalMarkdownFileStore(),workspace.repositories,documentCommitter),id=>store.openProject(id).repositories.findPrimaryForProject(id)?.localPath??null);
 };
 // The planner follows the wired engine, with the provider's planning model and auth mode.
 const providerConnection=(projectId:string,database:ConstructorParameters<typeof SqliteAgentExecutionRepository>[0])=>new SqliteAgentExecutionRepository(database,agentAdapter.providerId).listProfiles(projectId).find(profile=>profile.roleKey==='DEVELOPER');
 const plannerFor=(projectId:string,database:ConstructorParameters<typeof SqliteAgentExecutionRepository>[0],cwd:string):ChangeSetPlannerPort=>{
  if(agentAdapter.providerId!=='claude-code')return new CodexChangeSetPlanner(cwd);
  const profile=providerConnection(projectId,database);
  return new ClaudeChangeSetPlanner(cwd,{authMode:profile?.connectionConfig.authMode==='api_key'?'api_key':'subscription',defaultModel:profile?.models.planning??null});
 };
 // Project inception: one service per project (it tracks its background engine call). The engine follows the wired provider.
 const inceptions=new Map<string,ProjectInceptionService>();
 const getInception=(projectId:string)=>{
  const cached=inceptions.get(projectId);if(cached)return cached;
  const workspace=store.openProject(projectId);
  const claudeEngine=()=>{
   if(agentAdapter.providerId!=='claude-code')throw new Error('El asistente de inicio todavía solo funciona con Claude Code.');
   const profile=providerConnection(projectId,workspace.database);
   // A neutral working directory: no project instructions (CLAUDE.md) leak into the inception.
   const cwd=join(workspaceRoot,'projects',projectId);mkdirSync(cwd,{recursive:true});
   return new ClaudeInceptionEngine(cwd,{authMode:profile?.connectionConfig.authMode==='api_key'?'api_key':'subscription',defaultModel:profile?.models.planning??null});
  };
  // Built per call, so `inception:get` works with any engine and auth changes apply to the next call.
  const engine:InceptionEnginePort=dependencies.inceptionEngine??{askGoals:input=>claudeEngine().askGoals(input),propose:input=>claudeEngine().propose(input)};
  // The reference translator is its own model call (the only one with a tool: Read, inside a throwaway folder with copies of the files).
  const translator:ReferenceTranslatorPort=dependencies.referenceTranslator??{translate:input=>{
   if(agentAdapter.providerId!=='claude-code')throw new Error('El análisis de referencias todavía solo funciona con Claude Code.');
   const profile=providerConnection(projectId,workspace.database);
   const cwd=join(workspaceRoot,'projects',projectId);mkdirSync(cwd,{recursive:true});
   return new ClaudeReferenceTranslator(cwd,{authMode:profile?.connectionConfig.authMode==='api_key'?'api_key':'subscription'}).translate(input);
  }};
  const service=new ProjectInceptionService({projects:workspace.projects,graph:workspace.graph,store:new SqliteInceptionRepository(workspace.database),engine,
   planning:{submit:(id,draft,originRefId)=>getPlanning(id).submit(id,draft,originRefId,'AI_CHAT'),find:id=>new SqliteChangeSetRepository(workspace.database).findById(id),apply:async id=>{const result=await getPlanning(projectId).apply(id);return {revision:result.revision,resolvedIds:result.resolvedIds};},reject:id=>{getPlanning(projectId).reject(id);}},
   repositoryPath:id=>workspace.repositories.findPrimaryForProject(id)?.localPath??null,
   translator,referenceFiles:new InceptionReferenceFiles(join(workspaceRoot,'projects')),
   models:id=>{const profile=providerConnection(id,workspace.database);return {planning:profile?.models.planning??null,available:profile?.models.available??[]};},
   emit:(channel,payload)=>emit(channel,payload)});
  inceptions.set(projectId,service);return service;
 };
 const getContextEngine=(projectId:string)=>{const workspace=store.openProject(projectId);return new ContextEngine(new SqliteContextRepository(workspace.database),new RepositoryContextFileStore());};
 const getExecutionService=(projectId:string)=>{
  const cached=executionServices.get(projectId);if(cached)return cached;
  const workspace=store.openProject(projectId),repository=new SqliteAgentExecutionRepository(workspace.database,agentAdapter.providerId),contextEngine=getContextEngine(projectId);
  const contextBuilder={build:async(input:{projectId:string;focusEntityId:string;extraFocusEntityIds?:string[];repositoryRoot:string;executionId:string;sourceCommit:string})=>contextEngine.preview({projectId:input.projectId,focusEntityId:input.focusEntityId,...(input.extraFocusEntityIds?.length?{extraFocusEntityIds:input.extraFocusEntityIds}:{}),executionId:input.executionId,sourceCommit:input.sourceCommit,maxAllowedTokens:32_000,maxHops:2})};
  const validator=new ExecutionValidator(workspaceRoot,(executionId,repositoryId,diffs)=>repository.recordFileDiffs(executionId,repositoryId,diffs));
  // Plan changes agents propose when closing a task: stored as AGENT_EXECUTION ChangeSets, applied only under the decision policy.
  const planProposals:PlanProposalPort={
   normalize:operations=>operations.map(operation=>normalizeOperation(operation,'El agente')),
   submit:async(id,proposal,originRefId)=>{const changeSet=getPlanning(id).submit(id,proposal,originRefId);return {changeSetId:changeSet.id,status:changeSet.status,issues:changeSet.validationIssues.filter(issue=>issue.severity==='ERROR').map(issue=>issue.message)};},
   apply:async changeSetId=>{const result=await getPlanning(projectId).apply(changeSetId);emit('graph:revision_updated',{projectId:result.changeSet.projectId,revision:result.revision});return {revision:result.revision,resolvedIds:result.resolvedIds};},
   appliedAgentOperations:id=>new SqliteChangeSetRepository(store.openProject(id).database).list(id).filter(changeSet=>changeSet.originType==='AGENT_EXECUTION'&&changeSet.status==='APPLIED').map(changeSet=>changeSet.operations),
  };
  const service=new AgentOrchestrator(repository,contextBuilder,new ExecutionEventLog(workspaceRoot),agentAdapter,new GitIsolationService(),validator,workspaceRoot,(channel,payload)=>emit(channel,payload),planProposals);
  executionServices.set(projectId,service);return service;
 };
 // Repairs leftovers of an interrupted ChangeSet apply before the watcher starts reporting on docs/.
 const recoverDocuments=async(projectId:string)=>{
  const management=getManagement(projectId),root=management.repositoryPath(projectId);if(!root)return;
  const known=new Map(management.list(projectId).map(document=>[document.relativePath,document.contentHash]));
  await new TransactionalMarkdownFileStore().recoverInterruptedWrites(root,known).catch(()=>undefined);
 };
 // One autopilot service per project, sharing that project's orchestrator.
 const getPilot=(projectId:string)=>{const cached=pilots.get(projectId);if(cached)return cached;const pilot=new FeaturePilot(getExecutionService(projectId),new SqlitePilotRepository(store.openProject(projectId).database),(channel,payload)=>emit(channel,payload));pilots.set(projectId,pilot);return pilot;};
 const featureReport=(projectId:string,featureId:string)=>{
  const workspace=store.openProject(projectId);const feature=workspace.graph.findEntityById(featureId);if(!feature||feature.projectId!==projectId||feature.entityType!=='FEATURE')throw new Error('Feature no encontrada en este proyecto.');
  const report=new FeatureMetrics(getExecutionService(projectId),new SqlitePilotRepository(workspace.database)).report(projectId,featureId);
  return {report,markdown:renderFeatureReport(report,`${feature.displayKey} ${feature.title}`)};
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
     await recoverDocuments(id);
     await startWatcher(id);
     getExecutionService(id).reconcileInterrupted(id);
     getPilot(id).reconcile(id);
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
      if(workspace.graph.findEntityById(id)){const details=new GetEntityInspectorDetailsUseCase(workspace.graph).execute(id);if(details.entity.type==='FEATURE'){const integration=getExecutionService(project.id).featureIntegration(project.id,id);return integration?{...details,integration}:details;}if(details.entity.type!=='WORK_ITEM')return details;const outcome=getExecutionService(project.id).taskOutcome(id);return {...details,allowedStatusChanges:manualWorkItemTransitions(details.entity.status as WorkItemStatus),...(outcome?{outcome:{summary:outcome.summary,files:outcome.files,checks:outcome.checks,mergedCommit:outcome.mergedCommit,integrationBranch:outcome.integrationBranch,createdAt:outcome.createdAt}}:{})};}
     }
     throw new Error(`Entity not found: ${id}`);
    }
    case 'repository:configure': {
     const projectId=String(args[0]??''),localPath=String(args[1]??'');
     const configured=await getManagement(projectId).configureRepository(projectId,localPath);
     await recoverDocuments(projectId);
     await startWatcher(projectId);
     return configured;
    }
    case 'repository:initialize': {
     const projectId=String(args[0]??''),localPath=String(args[1]??'');const workspace=store.openProject(projectId);const project=workspace.projects.findById(projectId)!;
     const created=await new GitRepositoryInitializer().initialize({path:localPath,projectName:project.props.name,description:project.props.description??null});
     const configured=await getManagement(projectId).configureRepository(projectId,created.localPath);
     await recoverDocuments(projectId);
     await startWatcher(projectId);
     emit('inception:updated',{projectId,...(({stage,status})=>({stage,status}))(getInception(projectId).get(projectId))});
     return {projectId,localPath:configured.localPath,initialCommit:created.initialCommit,files:created.files};
    }
    case 'inception:get': return getInception(String(args[0]??'')).get(String(args[0]??''));
    case 'inception:start': {const projectId=String(args[0]??'');return getInception(projectId).start(projectId,(args[1]??{}) as StartInceptionInput);}
    case 'inception:answer': {const projectId=String(args[0]??'');return getInception(projectId).answer(projectId,(Array.isArray(args[1])?args[1]:[]) as InceptionAnswerDto[],typeof args[2]==='string'?args[2]:undefined);}
    case 'inception:approve': {const projectId=String(args[0]??'');return getInception(projectId).approve(projectId);}
    case 'inception:restart': {const projectId=String(args[0]??'');return getInception(projectId).restart(projectId);}
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
    case 'context:preview_package': {
     // UI preview, outside any execution: it reflects the user's working copy and HEAD on purpose (no sourceCommit).
     const {sourceCommit:_ignored,...input}=args[0] as PreviewContextInput&{sourceCommit?:unknown};return getContextEngine(input.projectId).preview(input);}
    case 'context:get_snapshot': {const snapshotId=String(args[0]??'');for(const project of store.listProjects()){const workspace=store.openProject(project.id),repository=new SqliteContextRepository(workspace.database);if(repository.findSnapshot(snapshotId))return new ContextEngine(repository,new RepositoryContextFileStore()).getSnapshot(snapshotId);}throw new Error('ContextSnapshot no encontrado.');}
    case 'agent:list_profiles': return getExecutionService(String(args[0]??'')).listProfiles(String(args[0]??''));
    case 'execution:list': return getExecutionService(String(args[0]??'')).listExecutions(String(args[0]??'')).map(toAgentExecutionDto);
    case 'execution:list_events': return findExecutionService(String(args[0]??'')).listEvents(String(args[0]??''));
    case 'execution:start': {const input=args[0] as StartAgentExecutionInput;return toAgentExecutionDto(await getExecutionService(input.projectId).start(input));}
    case 'execution:cancel': {const executionId=String(args[0]??'');return toAgentExecutionDto(await findExecutionService(executionId).cancel(executionId));}
    case 'execution:accept': {const executionId=String(args[0]??'');const result=await findExecutionService(executionId).accept(executionId);return {...result,execution:toAgentExecutionDto(result.execution)};}
    case 'execution:request_changes': {const input=args[0] as import('../../../shared/contracts/agent-view.js').RequestExecutionChangesInput;return toAgentExecutionDto(await findExecutionService(input.executionId).requestChanges(input));}
    case 'execution:get_detail': {
     const executionId=String(args[0]??'');const detail=findExecutionService(executionId).detail(executionId);
     const logPath=join(workspaceRoot,'projects',detail.execution.projectId,'executions',detail.execution.id,'test-output.log');
     const testLog=existsSync(logPath)?readFileSync(logPath,'utf8').slice(-200_000):null;
     return {...detail,execution:toAgentExecutionDto(detail.execution),testLog};
    }
    case 'workitem:set_status': {const projectId=String(args[0]??'');return getExecutionService(projectId).setWorkItemStatus(projectId,String(args[1]??''),String(args[2]??'') as WorkItemStatus);}
    case 'policy:get': {const projectId=String(args[0]??'');return getExecutionService(projectId).getPolicy(projectId);}
    case 'policy:update': {const projectId=String(args[0]??'');const policy=args[1] as import('../../../shared/contracts/agent-view.js').ExecutionPolicyDto;return getExecutionService(projectId).updatePolicy(projectId,{writablePaths:policy?.writablePaths??[],readonlyPaths:policy?.readonlyPaths??[],deniedPaths:policy?.deniedPaths??[],allowedCommands:policy?.allowedCommands??[],...(typeof policy?.maxExecutionMinutes==='number'?{maxExecutionMinutes:policy.maxExecutionMinutes}:{}),...(typeof policy?.maxTurns==='number'||policy?.maxTurns===null?{maxTurns:policy.maxTurns}:{}),...(policy?.decisionPolicy!==undefined?{decisionPolicy:policy.decisionPolicy}:{})});}
    case 'pilot:get': {
     const projectId=String(args[0]??''),featureId=String(args[1]??'');const status=getPilot(projectId).status(projectId,featureId);const service=getExecutionService(projectId);
     return {...status,authMode:service.authMode(projectId),apiKeyAvailable:Boolean(process.env.ANTHROPIC_API_KEY),availableModels:service.listProfiles(projectId).find(profile=>profile.roleKey==='DEVELOPER')?.availableModels??[],integration:service.featureIntegration(projectId,featureId)};
    }
    case 'activity:list': {const projectId=String(args[0]??'');return new ActivityService(new SqliteActivityRepository(store.openProject(projectId).database),id=>getInception(id).activity(id)).list(projectId,typeof args[1]==='number'?args[1]:undefined);}
    case 'metrics:feature_report': {const projectId=String(args[0]??''),featureId=String(args[1]??'');return featureReport(projectId,featureId);}
    case 'metrics:export_report': {
     const projectId=String(args[0]??''),featureId=String(args[1]??'');const {markdown}=featureReport(projectId,featureId);
     if(!/^[a-f0-9-]{36}$/i.test(projectId))throw new Error('Proyecto inválido.');
     const directory=join(workspaceRoot,'projects',projectId,'reports');mkdirSync(directory,{recursive:true});
     const path=join(directory,`feature-${featureId.replace(/[^a-zA-Z0-9-]/g,'')}-${new Date().toISOString().replace(/[:.]/g,'-')}.md`);writeFileSync(path,markdown,'utf8');return {path};
    }
    case 'graph:context_flow': {
     const projectId=String(args[0]??''),workItemId=String(args[1]??'');
     const latest=getExecutionService(projectId).listExecutions(projectId).filter(execution=>execution.workItemId===workItemId&&execution.contextSnapshotId).sort((a,b)=>(b.startedAt??'').localeCompare(a.startedAt??''))[0];
     if(!latest?.contextSnapshotId)return {executionId:null,snapshotId:null,sources:[],conventions:[]};
     const snapshot=getContextEngine(projectId).getSnapshot(latest.contextSnapshotId);
     const known=new Set(store.openProject(projectId).graph.listEntities(projectId).map(entity=>entity.id));
     return {executionId:latest.id,snapshotId:snapshot.id,sources:snapshot.includedSources.filter(source=>known.has(source.sourceId)&&source.sourceId!==workItemId).map(source=>({entityId:source.sourceId,tier:source.authorityTier,origin:source.retrievalOrigin})),conventions:snapshot.includedSources.filter(source=>source.sourceId.startsWith('convention:')).map(source=>source.extractedContent)};
    }
    case 'pilot:set_autonomy': {const projectId=String(args[0]??'');return getPilot(projectId).setAutonomy(projectId,String(args[1]??''),args[2] as import('../../../shared/contracts/agent-view.js').SetFeatureAutonomyInput);}
    case 'pilot:start': {const projectId=String(args[0]??'');return getPilot(projectId).start(projectId,String(args[1]??''),{acknowledgeCost:Boolean((args[2] as {acknowledgeCost?:boolean}|undefined)?.acknowledgeCost)});}
    case 'pilot:stop': {const projectId=String(args[0]??'');return getPilot(projectId).stop(projectId,String(args[1]??''));}
    case 'pilot:resume': {const projectId=String(args[0]??'');return getPilot(projectId).resume(projectId,String(args[1]??''));}
    case 'feature:integrate': {
     // `pilot:updated` refreshes the feature panel and the activity (the shell's next step reads `integrations`).
     const projectId=String(args[0]??''),featureId=String(args[1]??'');const result=await getExecutionService(projectId).integrateFeature(projectId,featureId);
     emit('pilot:updated',{projectId,featureId,status:null});return result;}
    case 'provider:get_auth': {const projectId=String(args[0]??'');return {authMode:getExecutionService(projectId).authMode(projectId),apiKeyAvailable:Boolean(process.env.ANTHROPIC_API_KEY)};}
    case 'provider:set_auth_mode': {const projectId=String(args[0]??'');return {authMode:getExecutionService(projectId).setAuthMode(projectId,args[1] as 'subscription'|'api_key')};}
    case 'execution:resolve_approval': {const input=args[0] as {executionId:string;requestId:string;decision:import('../../../domain/agents/models.js').ApprovalDecision};await findExecutionService(input.executionId).resolveApproval(input.executionId,input.requestId,input.decision);return {resolved:true};}
    default: throw new Error(`Unsupported workspace IPC channel: ${channel}`);
   }
  },
  /** Resolves when the project's background inception call (if any) has finished (tests and shutdown). */
  async inceptionSettled(projectId:string):Promise<void>{await inceptions.get(projectId)?.settled(projectId);},
  close():void {for(const inception of inceptions.values())inception.shutdown();for(const pilot of pilots.values())pilot.shutdown();for(const service of executionServices.values())service.shutdown();for(const watcher of watchers.values())watcher.stop();watchers.clear();store.closeAll();},
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
function toAgentExecutionDto(execution:AgentExecution):import('../../../shared/contracts/agent-view.js').AgentExecutionDto{return {id:execution.id,projectId:execution.projectId,workItemId:execution.workItemId,profileId:execution.profileId,providerId:execution.providerId,sessionId:execution.sessionId,contextSnapshotId:execution.contextSnapshotId,status:execution.status,modelUsed:execution.modelUsed,initialCommit:execution.initialCommit,finalCommit:execution.finalCommit,branchOrWorktree:execution.branchOrWorktree,baseBranch:execution.baseBranch,executionBranch:execution.executionBranch??null,revisionOf:execution.revisionOf??null,reviewStatus:execution.reviewStatus??null,reviewNote:execution.reviewNote??null,mergedCommit:execution.mergedCommit??null,reviewedAt:execution.reviewedAt??null,resultSummary:execution.resultSummary,startedAt:execution.startedAt,completedAt:execution.completedAt,coveredWorkItemIds:coveredWorkItems(execution)};}
