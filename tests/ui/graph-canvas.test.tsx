// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { GraphCanvas } from '../../src/desktop/presentation/graph/GraphCanvas.js';

afterEach(cleanup);
it('renders proposed graph nodes as accessible, dashed ghosts before application',()=>{
 render(<GraphCanvas nodes={[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT',label:'Workspace',status:'ACTIVE'}]} edges={[]} ghostNodes={[{id:'$feature',key:'NEW-1',type:'FEATURE',label:'Member sign in',status:'GHOST',parentId:'root'}]} ghostEdges={[{id:'ghost-edge-1',source:'root',target:'$feature',type:'DOCUMENTED_BY',provenance:'CHANGESET'}]} selectedId="root" onSelect={()=>undefined} onFilter={()=>undefined}/>);
 expect(screen.getByLabelText('Propuesta: FEATURE: Member sign in')).toBeTruthy();expect(screen.getByText(/PROPUESTA · DOCUMENTED BY/)).toBeTruthy();
});

describe('living graph (Stage 6)',()=>{
 const nodes=[
  {id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'Workspace',status:'ACTIVE'},
  {id:'feat',key:'FEAT-001',type:'FEATURE' as const,label:'Tareas',status:'DRAFT',parentId:'root'},
  {id:'t1',key:'TASK-001',type:'WORK_ITEM' as const,label:'Crear',status:'DONE',parentId:'feat'},
  {id:'t2',key:'TASK-002',type:'WORK_ITEM' as const,label:'Listar',status:'IN_PROGRESS',parentId:'feat'},
  {id:'t3',key:'TASK-003',type:'WORK_ITEM' as const,label:'Contar',status:'BLOCKED',parentId:'feat'},
 ];
 afterEach(()=>{delete (window as {workspaceIpc?:unknown}).workspaceIpc;});
 it('colors tasks by live status, counts feature progress and shows the autopilot badge',async()=>{
  let emit:(event:{projectId:string;featureId:string;status:string|null})=>void=()=>undefined;
  (window as unknown as {workspaceIpc:unknown}).workspaceIpc={events:{onPilotUpdated:(listener:typeof emit)=>{emit=listener;return ()=>undefined;}},queries:{getContextFlow:vi.fn()}};
  render(<GraphCanvas projectId="p1" nodes={nodes} edges={[]} selectedId="root" onSelect={()=>undefined} onFilter={()=>undefined}/>);
  expect(screen.getByLabelText('WORK_ITEM: Listar').getAttribute('data-live')).toBe('true');
  expect(screen.getByText('EN CURSO')).toBeTruthy();expect(screen.getByText('✓ HECHA')).toBeTruthy();expect(screen.getByText('BLOQUEADA')).toBeTruthy();
  expect(screen.getByText(/1\/3 tareas/)).toBeTruthy();
  act(()=>emit({projectId:'other',featureId:'feat',status:'RUNNING'}));expect(screen.queryByText('PILOTO')).toBeNull();
  act(()=>emit({projectId:'p1',featureId:'feat',status:'RUNNING'}));expect(screen.getByText('PILOTO')).toBeTruthy();
  act(()=>emit({projectId:'p1',featureId:'feat',status:'COMPLETED'}));expect(screen.queryByText('PILOTO')).toBeNull();
 });
 it('draws the context that reached the selected task, by authority tier, and lets the user hide it',async()=>{
  const getContextFlow=vi.fn(async()=>({executionId:'e1',snapshotId:'s1',sources:[{entityId:'t1',tier:5,origin:'GRAPH'},{entityId:'feat',tier:3,origin:'GRAPH'}],conventions:['convention:TASK-001:1']}));
  (window as unknown as {workspaceIpc:unknown}).workspaceIpc={events:{onPilotUpdated:()=>()=>undefined},queries:{getContextFlow}};
  const {container}=render(<GraphCanvas projectId="p1" nodes={nodes} edges={[]} selectedId="t2" onSelect={()=>undefined} onFilter={()=>undefined}/>);
  await waitFor(()=>expect(screen.getByLabelText('WORK_ITEM: Crear').getAttribute('data-context-tier')).toBe('5'));
  expect(getContextFlow).toHaveBeenCalledWith('p1','t2');
  expect(screen.getByLabelText('FEATURE: Tareas').getAttribute('data-context-tier')).toBe('3');
  expect(container.querySelectorAll('[data-context-flow]')).toHaveLength(2);
  expect(screen.getByLabelText('Leyenda del contexto').textContent).toContain('1 convenciones');
  fireEvent.click(screen.getByRole('button',{name:/Ocultar contexto · 2/}));
  expect(container.querySelectorAll('[data-context-flow]')).toHaveLength(0);
  expect(screen.getByLabelText('WORK_ITEM: Crear').getAttribute('data-context-tier')).toBeNull();
 });
 it('asks for no context when the selection is not a task or the bridge is missing',()=>{
  render(<GraphCanvas projectId="p1" nodes={nodes} edges={[]} selectedId="t2" onSelect={()=>undefined} onFilter={()=>undefined}/>);
  expect(screen.getByText('EN CURSO')).toBeTruthy();
 });
});
