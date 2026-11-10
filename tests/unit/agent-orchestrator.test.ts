import { describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator, describePolicy } from '../../src/application/execution/agent-orchestrator.js';
import type { AgentAdapterPort } from '../../src/application/ports/agent-adapter-port.js';
import type { AgentExecutionRepositoryPort, ExecutionValidatorPort, GitIsolationPort } from '../../src/application/ports/agent-execution-port.js';
import type { AgentCapabilities, AgentEvent, AgentExecution } from '../../src/domain/agents/models.js';

const capabilities:AgentCapabilities={supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true};
const now=()=>new Date().toISOString();
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));

function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

function harness(options:{adapter?:Partial<AgentAdapterPort>;validate?:ExecutionValidatorPort['validate'];build?:()=>Promise<unknown>;seed?:AgentExecution[]}={}){
 const executions=new Map<string,AgentExecution>((options.seed??[]).map(item=>[item.id,item]));
 const events:Array<{executionId:string;event:AgentEvent}>=[];const statuses:string[]=[];
 const repository={
  findWorkItem:()=>({id:'task',displayKey:'TASK-001',status:'READY',title:'Task',summary:'Summary',acceptanceCriteria:[]}),
  findProfile:()=>({id:'profile',roleKey:'DEVELOPER',systemInstructions:'',provider:{id:'provider',providerKey:'codex'}}),
  getRepositoryRoot:()=>'/repo',getRepositoryId:()=>'repo-id',
  getAutonomyPolicy:()=>({id:'policy',projectId:'project',name:'p',writablePaths:[],readonlyPaths:[],deniedPaths:[],allowedCommands:[],autoApproveScopes:[],requireWorktreeIsolation:true}),
  listExecutions:()=>[...executions.values()].map(item=>({...item})),
  createExecution:(execution:AgentExecution)=>{executions.set(execution.id,{...execution});},
  updateExecution:(execution:AgentExecution)=>{executions.set(execution.id,{...execution});},
  findExecution:(id:string)=>executions.has(id)?{...executions.get(id)!}:null,
  appendEvent:(executionId:string,event:AgentEvent)=>{events.push({executionId,event});return {id:String(events.length),sequenceNo:events.length,createdAt:now()};},
 } as unknown as AgentExecutionRepositoryPort;
 const isolation={prepare:vi.fn(async()=>({workingDirectory:'/ws/projects/p/worktrees/e',branchName:'graphdev/task-001-e',baseCommit:'base'})),discard:vi.fn(async()=>undefined)} satisfies GitIsolationPort;
 const adapter:AgentAdapterPort={providerId:'codex',getCapabilities:()=>capabilities,async *run(){yield {type:'EXECUTION_FINISHED',timestamp:now(),summary:'done'};},cancel:vi.fn(async()=>undefined),respondToApproval:vi.fn(async()=>undefined),...options.adapter} as AgentAdapterPort;
 const validator:ExecutionValidatorPort={validate:options.validate??(async()=>({passed:true,finalCommit:'base',resultSummary:'ok',testSummary:null}))};
 const contextBuilder={build:vi.fn(async()=>{await options.build?.();return {snapshot:{id:'snapshot'},packageText:''};})};
 const orchestrator=new AgentOrchestrator(repository,contextBuilder as never,{append:async()=>undefined},adapter,isolation,validator,'/ws',(channel,payload)=>{if(channel==='execution:status_changed')statuses.push((payload as {status:string}).status);});
 return {orchestrator,repository,isolation,adapter,events,statuses,executions};
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
 const orphan=(status:AgentExecution['status']):AgentExecution=>({id:`orphan-${status}`,projectId:'project',workItemId:'task',profileId:'profile',providerId:'provider',sessionId:null,contextSnapshotId:'snapshot',status,modelUsed:null,initialCommit:'base',finalCommit:null,branchOrWorktree:'/ws/projects/p/worktrees/old',testSummary:null,resultSummary:null,startedAt:now(),completedAt:null});

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
