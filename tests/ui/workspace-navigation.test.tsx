// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceNavigationProvider } from '@desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '@desktop/state/WorkspaceShell.js';
import { activityItem, installShellIpc } from './shell-ipc.js';
const nodes=[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'Example Workspace',status:'ACTIVE'},{id:'feature',key:'FEAT-01',type:'FEATURE' as const,label:'Feature work',status:'DRAFT',parentId:'root'},{id:'task',key:'TASK-001',type:'WORK_ITEM' as const,label:'Primera tarea',status:'READY',parentId:'feature'}];
afterEach(cleanup);
async function open(){render(<WorkspaceNavigationProvider><WorkspaceShell/></WorkspaceNavigationProvider>);fireEvent.click((await screen.findByText('Example Workspace')).closest('button')!);await screen.findByRole('tablist',{name:'Vistas del proyecto'});}

it('updates navigation focus and inspector immediately when a graph node is selected',async()=>{
 const client=installShellIpc(nodes);await open();
 fireEvent.click(screen.getByRole('tab',{name:/Grafo/}));
 fireEvent.click(await screen.findByRole('button',{name:'FEATURE: Feature work'}));
 await waitFor(()=>expect(client.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('feature'));
 expect(screen.getByRole('heading',{name:'Feature work'})).toBeTruthy();
 expect(screen.getByText('Summary for feature')).toBeTruthy();
});

it('opens the project on Actividad with breadcrumb, explanation and the next step',async()=>{
 installShellIpc(nodes);await open();
 expect(screen.getByRole('tab',{name:/Actividad/}).getAttribute('aria-selected')).toBe('true');
 expect(within(screen.getByRole('navigation',{name:'Ruta'})).getByText('Example Workspace')).toBeTruthy();
 expect(screen.getByRole('heading',{level:1,name:'Actividad'})).toBeTruthy();
 expect(screen.queryByText(/Project graph|Structured project knowledge/)).toBeNull();
 expect(await screen.findByRole('heading',{name:'Ejecuta TASK-001 «Primera tarea» con un agente'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Ejecutar TASK-001'}));
 await waitFor(()=>expect(screen.getByRole('tab',{name:/Agentes/}).getAttribute('aria-selected')).toBe('true'));
 expect(window.workspaceIpc.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('task');
});

it('follows inbox actions to the target view and selects the work item',async()=>{
 const summary={attentionCount:1,running:[],items:[activityItem({id:'d',kind:'TASK_DONE',title:'TASK-001 Primera tarea terminada',workItemId:'task',target:'graph',needsAttention:true})]};
 installShellIpc(nodes,summary);await open();
 fireEvent.click(await screen.findByRole('button',{name:'Ver en el grafo'}));
 await waitFor(()=>expect(screen.getByRole('tab',{name:/Grafo/}).getAttribute('aria-selected')).toBe('true'));
 await waitFor(()=>expect(window.workspaceIpc.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('task'));
 expect(document.activeElement).toBe(screen.getByRole('heading',{level:1,name:'Grafo del proyecto'}));
});
