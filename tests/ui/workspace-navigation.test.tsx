// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceNavigationProvider } from '@desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '@desktop/state/WorkspaceShell.js';
import type { EntityInspectorDto, WorkspaceIpcClient, WorkspaceLoadedStateDto } from '../../src/shared/contracts/ipc-contracts.js';
const project={id:'p',name:'Example Workspace',slug:'example-workspace',description:null,currentRevision:1,createdAt:'now',updatedAt:'now'};
const graph={projectId:'p',revision:1,nodes:[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'Example Workspace',status:'ACTIVE'},{id:'feature',key:'FEAT-01',type:'FEATURE' as const,label:'Feature work',status:'DRAFT',parentId:'root'}],edges:[]};
const loaded:WorkspaceLoadedStateDto={project,graph,selectedEntityId:'root'};
function details(id:string):EntityInspectorDto {const node=graph.nodes.find(item=>item.id===id)!;return {entity:{id:node.id,key:node.key,type:node.type,label:node.label,status:node.status,summary:`Summary for ${id}`,...(node.parentId?{parentId:node.parentId}:{})},attributes:{},relationships:[],executionHistory:[]};}
afterEach(cleanup);
it('updates navigation focus and inspector immediately when a graph node is selected',async()=>{
 const client:WorkspaceIpcClient={commands:{createProject:vi.fn(async()=>project),openProject:vi.fn(async()=>loaded),configureRepository:vi.fn(async(projectId:string,localPath:string)=>({projectId,localPath})),createArtifact:vi.fn(),saveArtifact:vi.fn(),proposeChanges:vi.fn(),editChangeSet:vi.fn(),applyChangeSet:vi.fn(),rejectChangeSet:vi.fn(),startExecution:vi.fn(),cancelExecution:vi.fn(),acceptExecution:vi.fn(),setWorkItemStatus:vi.fn(),setFeatureAutonomy:vi.fn(),startPilot:vi.fn(),stopPilot:vi.fn(),resumePilot:vi.fn(),setAuthMode:vi.fn(),exportFeatureReport:vi.fn(),updateExecutionPolicy:vi.fn(),requestExecutionChanges:vi.fn(),resolveExecutionApproval:vi.fn()},queries:{listProjects:vi.fn(async()=>[project]),getGraphView:vi.fn(async()=>graph),getEntityInspectorDetails:vi.fn(async(id:string)=>details(id)),getRepositoryPath:vi.fn(async()=>null),listArtifacts:vi.fn(async()=>[]),getArtifact:vi.fn(),listChangeSets:vi.fn(async()=>[]),previewContext:vi.fn(),getContextSnapshot:vi.fn(),listAgentProfiles:vi.fn(async()=>[]),listExecutions:vi.fn(async()=>[]),getExecutionDetail:vi.fn(),getFeaturePilot:vi.fn(),getContextFlow:vi.fn(async()=>({executionId:null,snapshotId:null,sources:[],conventions:[]})),getFeatureReport:vi.fn(),getExecutionPolicy:vi.fn(),listExecutionEvents:vi.fn(async()=>[])},events:{onGraphRevisionUpdated:vi.fn(()=>()=>{}),onArtifactSyncStatusChanged:vi.fn(()=>()=>{}),onExecutionStatusChanged:vi.fn(()=>()=>{}),onPilotUpdated:vi.fn(()=>()=>{}),onExecutionEventReceived:vi.fn(()=>()=>{})}};
 Object.defineProperty(window,'workspaceIpc',{configurable:true,value:client});
 render(<WorkspaceNavigationProvider><WorkspaceShell/></WorkspaceNavigationProvider>);
 await waitFor(()=>expect(client.queries.listProjects).toHaveBeenCalled());
 fireEvent.click(screen.getByText('Example Workspace').closest('button')!);
 await screen.findByRole('button',{name:'FEATURE: Feature work'});
 fireEvent.click(screen.getByRole('button',{name:'FEATURE: Feature work'}));
 await waitFor(()=>expect(client.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('feature'));
 expect(screen.getByRole('heading',{name:'Feature work'})).toBeTruthy();
 expect(screen.getByText('Summary for feature')).toBeTruthy();
});
