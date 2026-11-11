// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { WorkspaceNavigationProvider } from '../../src/desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '../../src/desktop/state/WorkspaceShell.js';
import { activityItem,installShellIpc } from './shell-ipc.js';
import type { ChangeSetDto,EntityInspectorDto,WorkspaceIpcClient,WorkspaceLoadedStateDto } from '../../src/shared/contracts/ipc-contracts.js';

const project={id:'p',name:'Planning Project',slug:'planning-project',description:null,currentRevision:1,createdAt:'now',updatedAt:'now'};
const graph={projectId:'p',revision:1,nodes:[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'Planning Project',status:'ACTIVE'}],edges:[]};
const loaded:WorkspaceLoadedStateDto={project,graph,selectedEntityId:'root'};
const proposal:ChangeSetDto={id:'cs-1',projectId:'p',baseGraphRevision:1,originType:'AI_CHAT',title:'Add sign in',rationale:'Provide authentication.',status:'VALIDATED',operations:[{type:'CREATE_MODULE',tempId:'$module',parentId:'root',title:'Identity'},{type:'CREATE_FEATURE',tempId:'$feature',moduleId:'$module',title:'Sign in'}],validationIssues:[],createdAt:'now'};
afterEach(cleanup);
it('shows a validated proposal as graph ghosts and applies it only after explicit confirmation',async()=>{
 let saved:ChangeSetDto[]=[],currentRevision=1;const details:EntityInspectorDto={entity:{id:'root',key:'PROJ-01',type:'PROJECT_ROOT',label:'Planning Project',status:'ACTIVE',summary:''},attributes:{},relationships:[],executionHistory:[]};
 const client:WorkspaceIpcClient={commands:{createProject:vi.fn(async()=>project),openProject:vi.fn(async()=>loaded),configureRepository:vi.fn(async(projectId:string,localPath:string)=>({projectId,localPath})),createArtifact:vi.fn(),saveArtifact:vi.fn(),proposeChanges:vi.fn(async()=>{saved=[proposal];return proposal;}),editChangeSet:vi.fn(),applyChangeSet:vi.fn(async()=>{currentRevision=2;const applied={...proposal,status:'APPLIED' as const,appliedGraphRevision:2,appliedAt:'later'};saved=[applied];return {changeSet:applied,revision:2};}),rejectChangeSet:vi.fn(),startExecution:vi.fn(),cancelExecution:vi.fn(),acceptExecution:vi.fn(),setWorkItemStatus:vi.fn(),setFeatureAutonomy:vi.fn(),startPilot:vi.fn(),stopPilot:vi.fn(),resumePilot:vi.fn(),setAuthMode:vi.fn(),exportFeatureReport:vi.fn(),updateExecutionPolicy:vi.fn(),requestExecutionChanges:vi.fn(),resolveExecutionApproval:vi.fn()},queries:{listProjects:vi.fn(async()=>[project]),getGraphView:vi.fn(async()=>({...graph,revision:currentRevision})),getEntityInspectorDetails:vi.fn(async()=>details),getRepositoryPath:vi.fn(async()=>null),listArtifacts:vi.fn(async()=>[]),getArtifact:vi.fn(),listChangeSets:vi.fn(async()=>saved),previewContext:vi.fn(),getContextSnapshot:vi.fn(),listAgentProfiles:vi.fn(async()=>[{id:'dev',projectId:'p',roleKey:'DEVELOPER' as const,name:'Desarrollador Claude Code',defaultProviderId:'provider',providerId:'provider',providerName:'Claude Code CLI',capabilities:{supportsResume:true,supportsStreaming:true,supportsApprovals:false,supportsCancellation:true,supportsStructuredOutput:true,supportsWorktrees:true},defaultModel:'sonnet',planningModel:'opus',availableModels:['haiku','sonnet','opus']}]),listExecutions:vi.fn(async()=>[]),getExecutionDetail:vi.fn(),getFeaturePilot:vi.fn(),getContextFlow:vi.fn(async()=>({executionId:null,snapshotId:null,sources:[],conventions:[]})),getFeatureReport:vi.fn(),getActivity:vi.fn(),getExecutionPolicy:vi.fn(),listExecutionEvents:vi.fn(async()=>[])},events:{onGraphRevisionUpdated:vi.fn(()=>()=>{}),onArtifactSyncStatusChanged:vi.fn(()=>()=>{}),onExecutionStatusChanged:vi.fn(()=>()=>{}),onPilotUpdated:vi.fn(()=>()=>{}),onExecutionEventReceived:vi.fn(()=>()=>{})}};
 Object.defineProperty(window,'workspaceIpc',{configurable:true,value:client});render(<WorkspaceNavigationProvider><WorkspaceShell/></WorkspaceNavigationProvider>);
 await waitFor(()=>expect(client.queries.listProjects).toHaveBeenCalled());fireEvent.click(screen.getByRole('button',{name:/Planning Project/}));fireEvent.click(await screen.findByRole('tab',{name:/Grafo/}));await screen.findByRole('button',{name:'Proyecto: Planning Project'});fireEvent.click(screen.getByRole('tab',{name:/Planificar/}));
 expect(await screen.findByRole('heading',{name:'Planificar con Claude Code CLI'})).toBeTruthy();const model=await screen.findByLabelText('Modelo') as HTMLSelectElement;await waitFor(()=>expect(model.value).toBe('opus'));fireEvent.change(model,{target:{value:'sonnet'}});
 fireEvent.change(screen.getByLabelText('¿Qué quieres cambiar?'),{target:{value:'Add a sign in feature'}});fireEvent.click(screen.getByRole('button',{name:'Proponer cambios'}));
 await waitFor(()=>expect(client.commands.proposeChanges).toHaveBeenCalledWith('p','Add a sign in feature','root',undefined,'sonnet'));
 expect(await screen.findByLabelText('Propuesta: Feature: Sign in')).toBeTruthy();const apply=await screen.findByRole('button',{name:'Aplicar cambios'});expect((apply as HTMLButtonElement).disabled).toBe(false);fireEvent.click(apply);
 await waitFor(()=>expect(client.commands.applyChangeSet).toHaveBeenCalledWith('cs-1'));expect(await screen.findByText('Cambios aplicados y grafo actualizado.')).toBeTruthy();expect(await screen.findByText('REV 2')).toBeTruthy();
});

it('opens the proposal the inbox points to, lists proposals and keeps the JSON editor under Avanzado',async()=>{
 const nodes=[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'Example Workspace',status:'ACTIVE'},{id:'feat',key:'FEAT-001',type:'FEATURE' as const,label:'Búsqueda',status:'DRAFT',parentId:'root'}];
 const second:ChangeSetDto={...proposal,id:'cs-2',title:'Validar entradas',status:'CONFLICTED',validationIssues:[{operationIndex:0,severity:'ERROR',code:'X',message:'Falta el módulo padre.'}]};
 const client=installShellIpc(nodes,{attentionCount:1,running:[],items:[activityItem({id:'p',kind:'PLAN_PROPOSAL',title:'Propuesta de cambios al plan',needsAttention:true,changeSetId:'cs-2',target:'planning'})]});
 client.queries.listChangeSets=vi.fn(async()=>[proposal,second]);
 render(<WorkspaceNavigationProvider><WorkspaceShell/></WorkspaceNavigationProvider>);
 fireEvent.click((await screen.findByText('Example Workspace')).closest('button')!);
 fireEvent.click(await screen.findByRole('button',{name:'Ver propuesta'}));
 const card=await screen.findByRole('article',{name:'Propuesta de cambios'});
 await waitFor(()=>expect(within(card).getByRole('heading',{name:'Validar entradas'})).toBeTruthy());
 expect(within(card).getByText('Con conflictos')).toBeTruthy();expect(within(card).getByText('Falta el módulo padre.')).toBeTruthy();
 expect((within(card).getByRole('button',{name:'Aplicar cambios'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.queryByRole('combobox',{name:'Propuestas guardadas'})).toBeNull();
 const list=screen.getByRole('region',{name:/Propuestas/});expect(within(list).getByRole('button',{name:/Validar entradas/}).getAttribute('aria-current')).toBe('true');
 const editor=screen.getByLabelText('Operaciones JSON');expect(editor.closest('details')!.open).toBe(false);
 expect(within(card).getByText('Avanzado: editar las operaciones (JSON)')).toBeTruthy();
 expect(document.body.textContent).not.toMatch(/ChangeSet|CONFLICTED/);expect(within(card).getByText('Crear módulo')).toBeTruthy();
 fireEvent.click(within(list).getByRole('button',{name:/Add sign in/}));
 await waitFor(()=>expect(within(card).getByRole('heading',{name:'Add sign in'})).toBeTruthy());
 expect(client.queries.getActivity).toHaveBeenCalledTimes(1);
});
