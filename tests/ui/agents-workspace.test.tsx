// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import type { WorkspaceIpcClient } from '../../src/shared/contracts/ipc-contracts.js';
import type { AgentExecutionDto,AgentEventRecordDto,AgentProfileDto } from '../../src/shared/contracts/agent-view.js';
import { AgentsWorkspace } from '../../src/desktop/presentation/agents/AgentsWorkspace.js';

const originalShowModal=HTMLDialogElement.prototype.showModal;
afterEach(()=>{cleanup();if(originalShowModal)HTMLDialogElement.prototype.showModal=originalShowModal;else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;});
const profile:AgentProfileDto={id:'developer',projectId:'project',roleKey:'DEVELOPER',name:'Desarrollador Claude Code',defaultProviderId:'provider',providerId:'provider',providerName:'Claude Code CLI',capabilities:{supportsResume:true,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true},defaultModel:'sonnet',availableModels:['haiku','sonnet','opus']};
const execution:AgentExecutionDto={id:'execution-1',projectId:'project',workItemId:'task-ready',profileId:'developer',providerId:'provider',sessionId:null,contextSnapshotId:'snapshot-12345678',status:'RUNNING',modelUsed:null,initialCommit:'abc123',finalCommit:null,branchOrWorktree:null,resultSummary:null,startedAt:'now',completedAt:null};
const records:AgentEventRecordDto[]=[{id:'event-1',sequenceNo:1,createdAt:'2026-11-10T10:00:00.000Z',event:{type:'TOOL_INVOCATION_STARTED',timestamp:'now',callId:'call-1',toolName:'command_execution',args:{command:'npm test'}}}];
function client():WorkspaceIpcClient {return {commands:{createProject:vi.fn(),openProject:vi.fn(),configureRepository:vi.fn(),createArtifact:vi.fn(),saveArtifact:vi.fn(),proposeChanges:vi.fn(),editChangeSet:vi.fn(),applyChangeSet:vi.fn(),rejectChangeSet:vi.fn(),startExecution:vi.fn(async()=>execution),cancelExecution:vi.fn(async()=>({...execution,status:'CANCELLED' as const})),resolveExecutionApproval:vi.fn()},queries:{listProjects:vi.fn(async()=>[]),getGraphView:vi.fn(),getEntityInspectorDetails:vi.fn(),getRepositoryPath:vi.fn(async()=>'/tmp/repository'),listArtifacts:vi.fn(async()=>[]),getArtifact:vi.fn(),listChangeSets:vi.fn(async()=>[]),previewContext:vi.fn(),getContextSnapshot:vi.fn(),listAgentProfiles:vi.fn(async()=>[profile]),listExecutions:vi.fn(async()=>[execution]),listExecutionEvents:vi.fn(async()=>records)},events:{onGraphRevisionUpdated:vi.fn(()=>()=>{}),onArtifactSyncStatusChanged:vi.fn(()=>()=>{}),onExecutionStatusChanged:vi.fn(()=>()=>{}),onExecutionEventReceived:vi.fn(()=>()=>{})}};}

it('starts the selected READY WorkItem with a DEVELOPER profile and shows persisted stream events',async()=>{
 const ipc=client();Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 const task={id:'task-ready',key:'TASK-001',type:'WORK_ITEM' as const,label:'Implement the event stream',status:'READY'};
 render(<AgentsWorkspace projectId="project" nodes={[task]} selectedEntityId="task-ready"/>);
 await screen.findByRole('heading',{name:'Monitor de tareas'});
 await waitFor(()=>expect((screen.getByLabelText('Tarea lista') as HTMLSelectElement).value).toBe('task-ready'));
 await waitFor(()=>expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('sonnet'));
 fireEvent.click(screen.getByRole('button',{name:'Iniciar ejecución · Claude Code CLI'}));
 await waitFor(()=>expect(ipc.commands.startExecution).toHaveBeenCalledWith({projectId:'project',workItemId:'task-ready',profileId:'developer',model:'sonnet'}));
 expect(await screen.findByText(/ContextSnapshot:/)).toBeTruthy();
 expect(await screen.findByText(/command_execution: npm test/i)).toBeTruthy();
 expect(screen.getByRole('status').textContent).toContain('RUNNING');
});

it('preselects the default model and sends the one the user picks',async()=>{
 const ipc=client();Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 render(<AgentsWorkspace projectId="project" nodes={[{id:'task-ready',key:'TASK-001',type:'WORK_ITEM',label:'Task',status:'READY'}]} selectedEntityId="task-ready"/>);
 const select=await screen.findByLabelText('Modelo') as HTMLSelectElement;
 await waitFor(()=>expect(select.value).toBe('sonnet'));
 expect([...select.options].map(option=>option.textContent)).toEqual(['haiku','sonnet (predeterminado)','opus']);
 fireEvent.change(select,{target:{value:'opus'}});
 fireEvent.click(screen.getByRole('button',{name:'Iniciar ejecución · Claude Code CLI'}));
 await waitFor(()=>expect(ipc.commands.startExecution).toHaveBeenCalledWith({projectId:'project',workItemId:'task-ready',profileId:'developer',model:'opus'}));
});

it('shows denied actions, the usage limit and the model the engine reported',async()=>{
 const ipc=client();ipc.queries.listExecutions=vi.fn(async()=>[{...execution,modelUsed:'claude-sonnet-5-5'}]);
 ipc.queries.listExecutionEvents=vi.fn(async()=>[
  {id:'e1',sequenceNo:1,createdAt:'2026-11-10T10:00:00.000Z',event:{type:'ACTION_DENIED',timestamp:'now',toolName:'Write',target:'README.md',reason:'mode'}},
  {id:'e2',sequenceNo:2,createdAt:'2026-11-10T10:00:01.000Z',event:{type:'RATE_LIMIT_UPDATED',timestamp:'now',status:'allowed',window:'five_hour',utilization:0.66,resetsAt:null}},
 ]);Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 render(<AgentsWorkspace projectId="project" nodes={[]} selectedEntityId={null}/>);
 expect(await screen.findByText('Acción denegada por la política · Write: README.md')).toBeTruthy();
 expect(await screen.findByText('claude-sonnet-5-5')).toBeTruthy();
 expect(screen.getAllByText(/ventana de 5 h: 66 % usado/).length).toBeGreaterThan(0);
});

it('explains when no READY WorkItems are available',async()=>{
 const ipc=client();Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 render(<AgentsWorkspace projectId="project" nodes={[{id:'task-draft',key:'TASK-002',type:'WORK_ITEM',label:'Draft task',status:'DRAFT'}]} selectedEntityId="task-draft"/>);
 await screen.findByRole('heading',{name:'Monitor de tareas'});
 expect((screen.getByLabelText('Tarea lista') as HTMLSelectElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'Iniciar ejecución · Claude Code CLI'}) as HTMLButtonElement).disabled).toBe(true);
});

it('shows a named approval dialog and sends rejection when it closes',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const ipc=client();ipc.commands.resolveExecutionApproval=vi.fn(async()=>({resolved:true as const}));const awaiting={...execution,status:'AWAITING_APPROVAL' as const};ipc.queries.listExecutions=vi.fn(async()=>[awaiting]);ipc.queries.listExecutionEvents=vi.fn(async()=>[{id:'approval-record',sequenceNo:1,createdAt:'now',event:{type:'APPROVAL_REQUIRED',timestamp:'now',requestId:'approval-123',actionType:'COMMAND',target:'npm test',justification:'The agent requests test execution.'}}]);Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 render(<AgentsWorkspace projectId="project" nodes={[]} selectedEntityId={null}/>);
 const dialog=await screen.findByRole('dialog',{name:'Aprobación requerida'});expect(dialog.getAttribute('open')).not.toBeNull();
 (dialog as HTMLDialogElement).returnValue='reject';dialog.removeAttribute('open');fireEvent(dialog,new Event('close'));
 await waitFor(()=>expect(ipc.commands.resolveExecutionApproval).toHaveBeenCalledWith({executionId:'execution-1',requestId:'approval-123',decision:{approved:false,reason:'Aprobación rechazada o diálogo cerrado.'}}));
});
