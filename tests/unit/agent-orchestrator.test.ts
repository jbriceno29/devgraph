import { describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator, branchSlug, describePolicy } from '../../src/application/execution/agent-orchestrator.js';
import type { AgentAdapterPort } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentExecutionRepositoryPort, ExecutionValidatorPort, GitIsolationPort } from '../../src/application/ports/agent-execution-port.js';
import type { AgentCapabilities, AgentEvent, AgentExecution } from '../../src/domain/agents/models.js';
import { canTransitionWorkItem, type WorkItemStatus } from '../../src/domain/work-management/entities.js';

const capabilities:AgentCapabilities={supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};
const now=()=>new Date().toISOString();
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));

function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

function harness(options:{adapter?:Partial<AgentAdapterPort>;validate?:ExecutionValidatorPort['validate'];build?:()=>Promise<unknown>;seed?:AgentExecution[];taskStatus?:WorkItemStatus;dependencies?:Array<{id:string;displayKey:string;title:string;status:string}>;dependents?:Array<{id:string;displayKey:string;title:string;status:string}>;dependentDependencies?:Array<{id:string;displayKey:string;title:string;status:string}>;merge?:GitIsolationPort['squashMerge'];documents?:string[]}={}){
 const workItems=new Map<string,WorkItemStatus>([['task',options.taskStatus??'READY'],...(options.dependents??[]).map(item=>[item.id,item.status as WorkItemStatus] as [string,WorkItemStatus])]);
 const task={get status(){return workItems.get('task')!;},set status(value:WorkItemStatus){workItems.set('task',value);}};const prompts:string[]=[];let revision=1;const branches=new Map<string,{branchName:string;sourceBranch:string}>();const emitted:Array<{channel:string;payload:unknown}>=[];
 const executions=new Map<string,AgentExecution>((options.seed??[]).map(item=>[item.id,item]));
 const events:Array<{executionId:string;event:AgentEvent}>=[];const statuses:string[]=[];
 const repository={
  findWorkItem:()=>({id:'task',displayKey:'TASK-001',status:task.status,title:'Task',summary:'Summary',acceptanceCriteria:[]}),
  transitionWorkItem:(_projectId:string,id:string,to:WorkItemStatus)=>{const from=workItems.get(id)!;if(!canTransitionWorkItem(from,to))throw new Error(`invalid ${from}->${to}`);workItems.set(id,to);revision+=1;return revision;},
  listDependencies:(_projectId:string,id:string)=>id==='task'?(options.dependencies??[]):(options.dependentDependencies??[]),
  listDependents:()=>(options.dependents??[]).map(item=>({...item,status:workItems.get(item.id)!})),
  findFeatureFor:()=>({id:'feature',displayKey:'FEAT-001',title:'Gestión de tareas'}),
  getIntegrationBranch:(ownerId:string)=>branches.get(ownerId)??null,
  saveIntegrationBranch:(input:{ownerId:string;branchName:string;sourceBranch:string})=>{branches.set(input.ownerId,{branchName:input.branchName,sourceBranch:input.sourceBranch});},
  listFileDiffs:()=>[],
  listEvents:()=>[],
  listDocumentPaths:()=>options.documents??[],
  findProfile:()=>({id:'profile',roleKey:'DEVELOPER',systemInstructions:'',provider:{id:'provider',providerKey:'codex'}}),
  getRepositoryRoot:()=>'/repo',getRepositoryId:()=>'repo-id',
  getAutonomyPolicy:()=>({id:'policy',projectId:'project',name:'p',writablePaths:[],readonlyPaths:[],deniedPaths:[],allowedCommands:[],autoApproveScopes:[],requireWorktreeIsolation:true}),
  listExecutions:()=>[...executions.values()].map(item=>({...item})),
  createExecution:(execution:AgentExecution)=>{executions.set(execution.id,{...execution});},
  updateExecution:(execution:AgentExecution)=>{executions.set(execution.id,{...execution});},
  findExecution:(id:string)=>executions.has(id)?{...executions.get(id)!}:null,
  appendEvent:(executionId:string,event:AgentEvent)=>{events.push({executionId,event});return {id:String(events.length),sequenceNo:events.length,createdAt:now()};},
 } as unknown as AgentExecutionRepositoryPort;
 const isolation={prepare:vi.fn(async()=>({workingDirectory:'/ws/projects/p/worktrees/e',branchName:'graphdev/task-001-e',baseCommit:'base',baseBranch:'main'})),discard:vi.fn(async()=>undefined),currentBranch:vi.fn(async()=>'main'),branchExists:vi.fn(async()=>true),createIntegrationBranch:vi.fn(async(input:{preferredName:string})=>input.preferredName),squashMerge:vi.fn(options.merge??(async()=>({ok:true as const,commit:'merged',changed:true}))),mergeInto:vi.fn(async()=>({ok:true as const,commit:'synced',changed:true})),pathsDiffer:vi.fn(async()=>[] as string[]),uncommittedPaths:vi.fn(async()=>[] as string[])} satisfies GitIsolationPort;
 const adapter:AgentAdapterPort={providerId:'codex',getCapabilities:()=>capabilities,async *run(){yield {type:'EXECUTION_FINISHED',timestamp:now(),summary:'done'};},cancel:vi.fn(async()=>undefined),respondToApproval:vi.fn(async()=>undefined),...options.adapter} as AgentAdapterPort;
 const validator:ExecutionValidatorPort={validate:options.validate??(async()=>({passed:true,finalCommit:'base',resultSummary:'ok',testSummary:null}))};
 const contextBuilder={build:vi.fn(async()=>{await options.build?.();return {snapshot:{id:'snapshot'},packageText:''};})};
 const orchestrator=new AgentOrchestrator(repository,contextBuilder as never,{append:async()=>undefined},adapter,isolation,validator,'/ws',(channel,payload)=>{emitted.push({channel,payload});if(channel==='execution:status_changed')statuses.push((payload as {status:string}).status);});
 return {orchestrator,repository,isolation,adapter,events,statuses,executions,task,emitted,validator,workItemStatuses:workItems,prompts};
}

const start=(orchestrator:AgentOrchestrator)=>orchestrator.start({projectId:'project',workItemId:'task',profileId:'profile'});

describe('AgentOrchestrator cancellation (D5)',()=>{
 it('keeps CANCELLED when the user cancels while the diff is being validated',async()=>{
  const gate=deferred(),entered=deferred();
  const {orchestrator,repository,statuses}=harness({validate:async()=>{entered.resolve();await gate.promise;return {passed:true,finalCommit:'base',resultSummary:'ok',testSummary:null};}});
  const execution=await start(orchestrator);await entered.promise;
  expect(repository.findExecution(execution.id)!.status).toBe('VALIDATING');
  await orchestrator.cancel(execution.id);gate.resolve();await flush();
  expect(repository.findExecution(execution.id)!.status).toBe('CANCELLED');expect(statuses.at(-1)).toBe('CANCELLED');expect(statuses).not.toContain('COMPLETED');
 });

 it('persists CANCELLED before stopping the engine, so the ending stream cannot overwrite it',async()=>{
  const stop=deferred();
  const {orchestrator,repository,adapter,statuses}=harness({adapter:{
   async *run(){yield {type:'SESSION_INITIALIZED',timestamp:now(),externalSessionId:'s'};await stop.promise;yield {type:'EXECUTION_FAILED',timestamp:now(),errorCode:'KILLED',errorMessage:'terminated',isRecoverable:false};},
   cancel:vi.fn(async()=>{expect(repository.findExecution(execution.id)!.status).toBe('CANCELLED');stop.resolve();}),
  }});
  const execution=await start(orchestrator);await flush();
  await orchestrator.cancel(execution.id);await flush();
  expect(adapter.cancel).toHaveBeenCalledWith(execution.id);
  expect(repository.findExecution(execution.id)!.status).toBe('CANCELLED');expect(statuses.filter(status=>status==='FAILED')).toHaveLength(0);
 });
});

describe('AgentOrchestrator interrupted executions (D4)',()=>{
 const orphan=(status:AgentExecution['status']):AgentExecution=>({id:`orphan-${status}`,projectId:'project',workItemId:'task',profileId:'profile',providerId:'provider',sessionId:null,contextSnapshotId:'snapshot',status,modelUsed:null,initialCommit:'base',finalCommit:null,branchOrWorktree:'/ws/projects/p/worktrees/old',baseBranch:'main',testSummary:null,resultSummary:null,startedAt:now(),completedAt:null});

 it('fails every non-terminal execution the process is not running and records why',()=>{
  const {orchestrator,repository,events}=harness({seed:[orphan('RUNNING'),orphan('VALIDATING'),orphan('AWAITING_APPROVAL'),{...orphan('COMPLETED'),completedAt:now()}]});
  const reconciled=orchestrator.reconcileInterrupted('project');
  expect(reconciled.map(item=>item.id).sort()).toEqual(['orphan-AWAITING_APPROVAL','orphan-RUNNING','orphan-VALIDATING']);
  for(const id of ['orphan-RUNNING','orphan-VALIDATING','orphan-AWAITING_APPROVAL'])expect(repository.findExecution(id)).toMatchObject({status:'FAILED',branchOrWorktree:'/ws/projects/p/worktrees/old'});
  expect(repository.findExecution('orphan-COMPLETED')!.status).toBe('COMPLETED');
  expect(events.filter(item=>item.event.type==='EXECUTION_FAILED'&&item.event.errorCode==='EXECUTION_INTERRUPTED')).toHaveLength(3);
 });

 it('lets a task with an interrupted execution start again',async()=>{
  const {orchestrator,repository}=harness({seed:[orphan('RUNNING')]});
  const execution=await start(orchestrator);
  expect(execution.status).toBe('RUNNING');expect(repository.findExecution('orphan-RUNNING')!.status).toBe('FAILED');
 });

 it('does not reconcile executions this process is still running',async()=>{
  const {orchestrator,repository}=harness({adapter:{async *run(){yield {type:'SESSION_INITIALIZED',timestamp:now(),externalSessionId:'s'};await new Promise(()=>undefined);}}});
  const execution=await start(orchestrator);await flush();
  expect(orchestrator.reconcileInterrupted('project')).toEqual([]);expect(repository.findExecution(execution.id)!.status).toBe('RUNNING');
 });

 it('cancels an orphan without touching the engine',async()=>{
  const {orchestrator,repository,adapter}=harness({seed:[orphan('RUNNING')]});
  const result=await orchestrator.cancel('orphan-RUNNING');
  expect(result.status).toBe('CANCELLED');expect(repository.findExecution('orphan-RUNNING')!.status).toBe('CANCELLED');expect(adapter.cancel).not.toHaveBeenCalled();
 });
});

describe('AgentOrchestrator worktree cleanup',()=>{
 it('discards the worktree and branch when preparation fails before the agent runs',async()=>{
  const {orchestrator,isolation}=harness({build:async()=>{throw new Error('context failed');}});
  const execution=await start(orchestrator);
  expect(execution).toMatchObject({status:'FAILED',resultSummary:'context failed',branchOrWorktree:null});
  expect(isolation.discard).toHaveBeenCalledWith(expect.objectContaining({branchName:'graphdev/task-001-e',workingDirectory:'/ws/projects/p/worktrees/e',repositoryRoot:'/repo'}));
 });

 it('discards the worktree when the user cancels during context preparation',async()=>{
  const gate=deferred(),entered=deferred();
  const {orchestrator,repository,isolation}=harness({build:async()=>{entered.resolve();await gate.promise;}});
  const pending=start(orchestrator);await entered.promise;
  const id=[...(repository.listExecutions('project'))][0]!.id;await orchestrator.cancel(id);gate.resolve();
  const result=await pending;
  expect(result.status).toBe('CANCELLED');expect(isolation.discard).toHaveBeenCalledTimes(1);expect(repository.findExecution(id)!.branchOrWorktree).toBeNull();
 });

 it('keeps the worktree of an execution whose agent ran',async()=>{
  const {orchestrator,isolation,repository}=harness({validate:async()=>({passed:false,finalCommit:null,resultSummary:'audit failed',testSummary:null})});
  const execution=await start(orchestrator);await flush();
  expect(repository.findExecution(execution.id)).toMatchObject({status:'FAILED',branchOrWorktree:'/ws/projects/p/worktrees/e'});expect(isolation.discard).not.toHaveBeenCalled();
 });
});

describe('AgentOrchestrator task prompt',()=>{
 it('tells the engine its writable paths and the exact commands it may run, and passes the same policy to the adapter',async()=>{
  let received:{prompt:string;policy?:unknown}|undefined;
  const {orchestrator}=harness({adapter:{async *run(input){received=input;yield {type:'EXECUTION_FINISHED',timestamp:now(),summary:'done'};}}});
  await start(orchestrator);await flush();
  expect(received!.prompt).toContain('# Política de ejecución');
  expect(received!.prompt).toContain('No tienes permitido ejecutar comandos');
  expect(received!.policy).toEqual({writablePaths:[],readonlyPaths:[],deniedPaths:[],allowedCommands:[]});
 });

 it('lists allowed commands verbatim and forbids pipes, and lists denied paths',()=>{
  const text=describePolicy({writablePaths:['src/**','tests/**'],readonlyPaths:['docs/adr/**'],deniedPaths:['.env*'],allowedCommands:['node --test']});
  expect(text).toContain('- `src/**`\n- `tests/**`');
  expect(text).toContain('- `node --test`');
  expect(text).toContain('no tuberías, redirecciones ni `&&`');
  expect(text).toContain('Rutas prohibidas (no las leas ni las modifiques):\n- `.env*`');
  expect(text).toContain('Rutas de solo lectura:\n- `docs/adr/**`');
 });
});

describe('AgentOrchestrator work item lifecycle (Stage 1)',()=>{
 it('moves the task READY → IN_PROGRESS → IN_REVIEW, records the base branch and announces each graph revision',async()=>{
  const {orchestrator,repository,task,emitted}=harness();
  const execution=await start(orchestrator);
  expect(task.status).toBe('IN_PROGRESS');
  await flush();
  expect(repository.findExecution(execution.id)).toMatchObject({status:'COMPLETED',baseBranch:'main'});
  expect(task.status).toBe('IN_REVIEW');
  expect(emitted.filter(item=>item.channel==='graph:revision_updated').map(item=>item.payload)).toEqual([{projectId:'project',revision:2},{projectId:'project',revision:3}]);
 });

 it('makes the task available again when the run fails or is cancelled',async()=>{
  const failing=harness({validate:async()=>({passed:false,finalCommit:null,resultSummary:'audit failed',testSummary:null})});
  await start(failing.orchestrator);await flush();
  expect(failing.task.status).toBe('READY');
  const hanging=harness({adapter:{async *run(){yield {type:'SESSION_INITIALIZED',timestamp:now(),externalSessionId:'s'};await new Promise(()=>undefined);}}});
  const execution=await start(hanging.orchestrator);await flush();
  expect(hanging.task.status).toBe('IN_PROGRESS');
  await hanging.orchestrator.cancel(execution.id);
  expect(hanging.task.status).toBe('READY');
 });

 it('refuses to start while a DEPENDS_ON task is not DONE',async()=>{
  const {orchestrator,isolation}=harness({dependencies:[{id:'t0',displayKey:'TASK-000',title:'Base',status:'DONE'},{id:'t2',displayKey:'TASK-002',title:'Schema',status:'IN_PROGRESS'}]});
  await expect(start(orchestrator)).rejects.toThrow('depende de tareas sin terminar: TASK-002 (IN_PROGRESS)');
  expect(isolation.prepare).not.toHaveBeenCalled();
 });

 it('returns the task of an interrupted execution to READY',()=>{
  const orphan:AgentExecution={id:'orphan',projectId:'project',workItemId:'task',profileId:'profile',providerId:'provider',sessionId:null,contextSnapshotId:null,status:'RUNNING',modelUsed:null,initialCommit:'base',finalCommit:null,branchOrWorktree:null,baseBranch:null,testSummary:null,resultSummary:null,startedAt:now(),completedAt:null};
  const {orchestrator,task}=harness({seed:[orphan],taskStatus:'IN_PROGRESS'});
  orchestrator.reconcileInterrupted('project');
  expect(task.status).toBe('READY');
 });

 it('never overwrites a status the user changed while the agent was running',async()=>{
  const gate=deferred();
  const {orchestrator,task}=harness({validate:async()=>{await gate.promise;return {passed:true,finalCommit:'base',resultSummary:'ok',testSummary:null};}});
  await start(orchestrator);await flush();
  task.status='BLOCKED';gate.resolve();await flush();
  expect(task.status).toBe('BLOCKED');
 });

 it('asks the validator to commit the work with the task key and title',async()=>{
  let message:string|undefined;
  const {orchestrator}=harness({validate:async input=>{message=input.commitMessage;return {passed:true,finalCommit:'abc',resultSummary:'ok',testSummary:null};}});
  const execution=await start(orchestrator);await flush();
  expect(message).toBe(`TASK-001: Task\n\nGraph Workspace execution ${execution.id}`);
 });
});

describe('AgentOrchestrator review: accept and request changes (Stage 1.2)',()=>{
 const completed=async(options:Parameters<typeof harness>[0]={})=>{
  const h=harness({validate:async()=>({passed:true,finalCommit:'run-commit',resultSummary:'Diff audit passed.',testSummary:null}),...options});
  const execution=await start(h.orchestrator);await flush();
  return {...h,execution:h.repository.findExecution(execution.id)!};
 };

 it('creates the feature integration branch once, from the checked-out branch, and starts runs from it',async()=>{
  const {orchestrator,isolation}=await completed();
  expect(isolation.createIntegrationBranch).toHaveBeenCalledWith({repositoryRoot:'/repo',preferredName:'feature/feat-001-gestion-de-tareas',sourceRef:'HEAD'});
  expect(isolation.prepare).toHaveBeenLastCalledWith(expect.objectContaining({startPoint:'feature/feat-001-gestion-de-tareas'}));
  expect(branchSlug('FEAT-002','Añadir búsqueda: ¿rápida?')).toBe('feat-002-anadir-busqueda-rapida');
  void orchestrator;
 });

 it('squash-merges into the integration branch, marks the task DONE, cleans up and unblocks ready dependents',async()=>{
  const {orchestrator,isolation,repository,task,execution,workItemStatuses}=await completed({
   dependents:[{id:'t2',displayKey:'TASK-002',title:'Next',status:'BLOCKED'},{id:'t3',displayKey:'TASK-003',title:'Other',status:'BLOCKED'}],
  });
  // t3 also waits for an unfinished task.
  (repository as unknown as {listDependencies:(p:string,id:string)=>unknown}).listDependencies=(_p:string,id:string)=>id==='t3'?[{id:'x',displayKey:'TASK-009',title:'x',status:'READY'}]:id==='t2'?[{id:'task',displayKey:'TASK-001',title:'Task',status:workItemStatuses.get('task')}]:[];
  expect(task.status).toBe('IN_REVIEW');
  const result=await orchestrator.accept(execution.id);
  expect(isolation.squashMerge).toHaveBeenCalledWith(expect.objectContaining({targetBranch:'main',sourceRef:'run-commit',message:`TASK-001: Task\n\nGraph Workspace execution ${execution.id}`}));
  expect(result).toMatchObject({merged:true,conflict:null,execution:{reviewStatus:'ACCEPTED',mergedCommit:'merged',branchOrWorktree:null}});
  expect(isolation.discard).toHaveBeenCalledWith(expect.objectContaining({branchName:'graphdev/task-001-e'}));
  expect(task.status).toBe('DONE');
  expect(workItemStatuses.get('t2')).toBe('READY');
  expect(workItemStatuses.get('t3')).toBe('BLOCKED');
  await expect(orchestrator.accept(execution.id)).rejects.toThrow('ya fue revisada');
 });

 it('keeps the task IN_REVIEW and records the conflict when the merge fails',async()=>{
  const {orchestrator,task,execution,isolation}=await completed({merge:async()=>({ok:false as const,reason:'CONFLICT' as const,detail:'Conflicto al integrar.',conflicts:['src/base.ts']})});
  const result=await orchestrator.accept(execution.id);
  expect(result).toMatchObject({merged:false,conflict:{reason:'CONFLICT',files:['src/base.ts']},execution:{reviewStatus:'MERGE_CONFLICT'}});
  expect(task.status).toBe('IN_REVIEW');expect(isolation.discard).not.toHaveBeenCalled();
 });

 it('re-runs from the previous commit with the reviewer feedback in the prompt, and supersedes the old run',async()=>{
  const prompts:string[]=[];
  const {orchestrator,isolation,repository,task,execution}=await completed({adapter:{async *run(input){prompts.push(input.prompt);yield {type:'EXECUTION_FINISHED',timestamp:now(),summary:'done'};}}});
  const revision=await orchestrator.requestChanges({executionId:execution.id,feedback:'Valida también títulos de más de 200 caracteres.'});
  expect(isolation.prepare).toHaveBeenLastCalledWith(expect.objectContaining({startPoint:'run-commit'}));
  expect(revision).toMatchObject({revisionOf:execution.id,baseBranch:'main'});
  expect(prompts.at(-1)).toContain('# Ajustes solicitados');expect(prompts.at(-1)).toContain('Valida también títulos de más de 200 caracteres.');
  expect(repository.findExecution(execution.id)).toMatchObject({reviewStatus:'CHANGES_REQUESTED',reviewNote:'Valida también títulos de más de 200 caracteres.',branchOrWorktree:null});
  await flush();
  expect(task.status).toBe('IN_REVIEW');
  await expect(orchestrator.requestChanges({executionId:execution.id,feedback:'otra vez'})).rejects.toThrow('no se haya aceptado ni ajustado');
 });

 it('refuses to accept or request changes outside of review',async()=>{
  const {orchestrator,task,execution}=await completed();
  task.status='BLOCKED';
  await expect(orchestrator.accept(execution.id)).rejects.toThrow('debe estar en revisión');
  await expect(orchestrator.requestChanges({executionId:execution.id,feedback:'x'})).rejects.toThrow('debe estar en revisión');
 });
});
