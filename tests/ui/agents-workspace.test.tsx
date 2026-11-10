// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import type { WorkspaceIpcClient } from '../../src/shared/contracts/ipc-contracts.js';
import type { AgentExecutionDto,AgentEventRecordDto,AgentProfileDto } from '../../src/shared/contracts/agent-view.js';
import { AgentsWorkspace } from '../../src/desktop/presentation/agents/AgentsWorkspace.js';

afterEach(cleanup);
const profile:AgentProfileDto={id:'developer',projectId:'project',roleKey:'DEVELOPER',name:'Desarrollador Codex',defaultProviderId:'provider',providerId:'provider',providerName:'Codex CLI',capabilities:{supportsResume:false,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true}};
const execution:AgentExecutionDto={id:'execution-1',projectId:'project',workItemId:'task-ready',profileId:'developer',providerId:'provider',sessionId:null,contextSnapshotId:'snapshot-12345678',status:'RUNNING',modelUsed:null,initialCommit:'abc123',finalCommit:null,branchOrWorktree:null,resultSummary:null,startedAt:'now',completedAt:null};
const records:AgentEventRecordDto[]=[{id:'event-1',sequenceNo:1,createdAt:'2026-11-10T10:00:00.000Z',event:{type:'TOOL_INVOCATION_STARTED',timestamp:'now',callId:'call-1',toolName:'command_execution',args:{command:'npm test'}}}];
function client():WorkspaceIpcClient {return {commands:{createProject:vi.fn(),openProject:vi.fn(),configureRepository:vi.fn(),createArtifact:vi.fn(),saveArtifact:vi.fn(),proposeChanges:vi.fn(),editChangeSet:vi.fn(),applyChangeSet:vi.fn(),rejectChangeSet:vi.fn(),startExecution:vi.fn(async()=>execution),cancelExecution:vi.fn(async()=>({...execution,status:'CANCELLED' as const}))},queries:{listProjects:vi.fn(async()=>[]),getGraphView:vi.fn(),getEntityInspectorDetails:vi.fn(),getRepositoryPath:vi.fn(async()=>'/tmp/repository'),listArtifacts:vi.fn(async()=>[]),getArtifact:vi.fn(),listChangeSets:vi.fn(async()=>[]),previewContext:vi.fn(),getContextSnapshot:vi.fn(),listAgentProfiles:vi.fn(async()=>[profile]),listExecutions:vi.fn(async()=>[execution]),listExecutionEvents:vi.fn(async()=>records)},events:{onGraphRevisionUpdated:vi.fn(()=>()=>{}),onArtifactSyncStatusChanged:vi.fn(()=>()=>{}),onExecutionStatusChanged:vi.fn(()=>()=>{}),onExecutionEventReceived:vi.fn(()=>()=>{})}};}

it('starts the selected READY WorkItem with a DEVELOPER profile and shows persisted stream events',async()=>{
 const ipc=client();Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 const task={id:'task-ready',key:'TASK-001',type:'WORK_ITEM' as const,label:'Implement the event stream',status:'READY'};
 render(<AgentsWorkspace projectId="project" nodes={[task]} selectedEntityId="task-ready"/>);
 await screen.findByRole('heading',{name:'Monitor de tareas'});
 await waitFor(()=>expect((screen.getByLabelText('Tarea lista') as HTMLSelectElement).value).toBe('task-ready'));
 fireEvent.click(screen.getByRole('button',{name:'Iniciar ejecución Codex'}));
 await waitFor(()=>expect(ipc.commands.startExecution).toHaveBeenCalledWith({projectId:'project',workItemId:'task-ready',profileId:'developer'}));
 expect(await screen.findByText(/ContextSnapshot:/)).toBeTruthy();
 expect(await screen.findByText(/command_execution: npm test/i)).toBeTruthy();
 expect(screen.getByRole('status').textContent).toContain('RUNNING');
});

it('explains when no READY WorkItems are available',async()=>{
 const ipc=client();Object.defineProperty(window,'workspaceIpc',{configurable:true,value:ipc});
 render(<AgentsWorkspace projectId="project" nodes={[{id:'task-draft',key:'TASK-002',type:'WORK_ITEM',label:'Draft task',status:'DRAFT'}]} selectedEntityId="task-draft"/>);
 await screen.findByRole('heading',{name:'Monitor de tareas'});
 expect((screen.getByLabelText('Tarea lista') as HTMLSelectElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'Iniciar ejecución Codex'}) as HTMLButtonElement).disabled).toBe(true);
});
