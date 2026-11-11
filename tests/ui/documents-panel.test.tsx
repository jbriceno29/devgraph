// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentsPanel } from '../../src/desktop/presentation/documents/DocumentsPanel.js';
import type { ArtifactDocumentDto, ArtifactDocumentViewDto } from '../../src/shared/contracts/artifact-view.js';
import type { WorkspaceIpcClient, WorkspaceIpcEvents } from '../../src/shared/contracts/ipc-contracts.js';

const artifactRecord:ArtifactDocumentDto={id:'doc-1',projectId:'p',displayKey:'DOC-001',title:'Project brief',summary:'',entityType:'ARTIFACT',artifactType:'PRD',version:1,adrNumber:null,relativePath:'docs/PRD.md',contentHash:'hash-1',syncStatus:'SYNCED'};
const view:ArtifactDocumentViewDto={document:artifactRecord,content:'# Project brief\n\nInitial content.\n\n<script>alert("unsafe")</script>'};
afterEach(cleanup);

it('renders a safe Markdown preview, saves through typed IPC, and reflects watcher events',async()=>{
 let onSync:((event:WorkspaceIpcEvents['artifact:sync_status_changed'])=>void)|undefined;let currentView=view;
 const client:WorkspaceIpcClient={
  commands:{createProject:vi.fn(),openProject:vi.fn(),configureRepository:vi.fn(),createArtifact:vi.fn(),saveArtifact:vi.fn(async(_documentId:string,_hash:string,content:string)=>({document:{...artifactRecord,contentHash:'hash-2'},content})),proposeChanges:vi.fn(),editChangeSet:vi.fn(),applyChangeSet:vi.fn(),rejectChangeSet:vi.fn(),startExecution:vi.fn(),cancelExecution:vi.fn(),acceptExecution:vi.fn(),setWorkItemStatus:vi.fn(),updateExecutionPolicy:vi.fn(),requestExecutionChanges:vi.fn(),resolveExecutionApproval:vi.fn()},
  queries:{listProjects:vi.fn(async()=>[]),getGraphView:vi.fn(),getEntityInspectorDetails:vi.fn(),getRepositoryPath:vi.fn(async()=>'/tmp/repository'),listArtifacts:vi.fn(async()=>[artifactRecord]),getArtifact:vi.fn(async()=>currentView),listChangeSets:vi.fn(async()=>[]),previewContext:vi.fn(),getContextSnapshot:vi.fn(),listAgentProfiles:vi.fn(async()=>[]),listExecutions:vi.fn(async()=>[]),getExecutionDetail:vi.fn(),getExecutionPolicy:vi.fn(),listExecutionEvents:vi.fn(async()=>[])},
  events:{onGraphRevisionUpdated:vi.fn(()=>()=>{}),onArtifactSyncStatusChanged:vi.fn(listener=>{onSync=listener;return ()=>{onSync=undefined;};}),onExecutionStatusChanged:vi.fn(()=>()=>{}),onExecutionEventReceived:vi.fn(()=>()=>{})},
 };
 Object.defineProperty(window,'workspaceIpc',{configurable:true,value:client});
 render(<DocumentsPanel projectId="p" nodes={[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT',label:'Workspace',status:'ACTIVE'}]}/>);
 expect(await screen.findByRole('heading',{name:'Project brief'})).toBeTruthy();
 await waitFor(()=>expect((screen.getByLabelText('Editor Markdown — contenido') as HTMLTextAreaElement).value).toBe(view.content));
 expect(screen.getByText('Initial content.')).toBeTruthy();
 expect(window.document.querySelector('script')).toBeNull();
 fireEvent.change(screen.getByLabelText('Editor Markdown — contenido'),{target:{value:'# Project brief\n\nUpdated in editor.'}});
 fireEvent.click(screen.getByRole('button',{name:'Guardar Markdown'}));
 await waitFor(()=>expect(client.commands.saveArtifact).toHaveBeenCalledWith('doc-1','hash-1','# Project brief\n\nUpdated in editor.'));
 expect(await screen.findByText('Documento guardado y sincronizado.')).toBeTruthy();
 currentView={...view,document:{...artifactRecord,syncStatus:'DRIFTED'}};
 await act(async()=>{onSync?.({projectId:'p',documentId:'doc-1',relativePath:'docs/PRD.md',syncStatus:'DRIFTED'});});
 expect((await screen.findAllByText('Cambio externo')).length).toBeGreaterThan(0);
});
