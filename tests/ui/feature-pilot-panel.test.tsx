// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePilotPanel } from '../../src/desktop/presentation/agents/FeaturePilotPanel.js';
import type { FeaturePilotDto } from '../../src/shared/contracts/agent-view.js';

afterEach(cleanup);
const nodes=[{id:'feat',key:'FEAT-001',type:'FEATURE' as const,label:'Gestión de tareas',status:'DRAFT'},{id:'t1',key:'TASK-001',type:'WORK_ITEM' as const,label:'T',status:'READY'}];
const base:FeaturePilotDto={autonomy:{featureId:'feat',level:'PILOT',executionModel:'haiku',escalationModel:'sonnet',maxAttempts:3,usagePauseThreshold:0.85},run:null,events:[],tasks:[{id:'t1',displayKey:'TASK-001',title:'T',status:'READY',dependsOn:[]},{id:'t2',displayKey:'TASK-002',title:'T2',status:'DONE',dependsOn:[]}],usage:{utilization:0.42,window:'five_hour',resetsAt:null,status:'allowed'},running:false,authMode:'subscription',apiKeyAvailable:false,availableModels:['haiku','sonnet','opus']};
function ipc(state:FeaturePilotDto=base){
 const value={commands:{setFeatureAutonomy:vi.fn(async(_p:string,_f:string,input:{level:string})=>({...state.autonomy,...input})),startPilot:vi.fn(async()=>({id:'run',featureId:'feat',status:'RUNNING',reason:null,startedAt:'now',endedAt:null})),stopPilot:vi.fn(async()=>null),resumePilot:vi.fn(async()=>null),setAuthMode:vi.fn(async()=>({authMode:'api_key'}))},queries:{getFeaturePilot:vi.fn(async()=>state)},events:{onPilotUpdated:vi.fn(()=>()=>{})}};
 Object.defineProperty(window,'workspaceIpc',{configurable:true,value});return value;
}

describe('FeaturePilotPanel',()=>{
 it('saves the autonomy level and its settings for the selected feature',async()=>{
  const client=ipc({...base,autonomy:{...base.autonomy,level:'MANUAL'}});
  render(<FeaturePilotPanel projectId="p" nodes={nodes}/>);
  fireEvent.click(await screen.findByLabelText(/Auto-aceptar/));
  fireEvent.change(screen.getByLabelText('Modelo de ejecución'),{target:{value:'haiku'}});
  fireEvent.change(screen.getByLabelText('Intentos por tarea'),{target:{value:'2'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar autonomía'}));
  await waitFor(()=>expect(client.commands.setFeatureAutonomy).toHaveBeenCalledWith('p','feat',{level:'AUTO_ACCEPT',executionModel:'haiku',escalationModel:'sonnet',maxAttempts:2,usagePauseThreshold:0.85}));
 });

 it('shows the cost warning and starts only after it is acknowledged',async()=>{
  const client=ipc();
  render(<FeaturePilotPanel projectId="p" nodes={nodes}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Iniciar piloto'}));
  const warning=screen.getByRole('group',{name:'Aviso de costo'});
  expect(warning.textContent).toContain('Quedan 1 tareas');expect(warning.textContent).toContain('42 % de la ventana de 5 h');expect(warning.textContent).toContain('se pausará al llegar al 85 %');
  const start=screen.getByRole('button',{name:'Iniciar'}) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Entiendo el costo/));
  fireEvent.click(start);
  await waitFor(()=>expect(client.commands.startPilot).toHaveBeenCalledWith('p','feat',{acknowledgeCost:true}));
 });

 it('lets the user stop a running pilot, and resume one that waits, showing why',async()=>{
  const running=ipc({...base,run:{id:'run',featureId:'feat',status:'RUNNING',reason:null,startedAt:'now',endedAt:null},events:[{id:'e1',sequenceNo:1,kind:'TASK_STARTED',message:'TASK-001: intento 1 de 3 con haiku.',workItemId:'t1',executionId:null,createdAt:'2026-11-10T10:00:00Z'}]});
  render(<FeaturePilotPanel projectId="p" nodes={nodes}/>);
  expect(await screen.findByText(/TASK-001: intento 1 de 3 con haiku/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Detener piloto'}));
  await waitFor(()=>expect(running.commands.stopPilot).toHaveBeenCalledWith('p','feat'));
  cleanup();
  const waiting=ipc({...base,run:{id:'run',featureId:'feat',status:'WAITING_USER',reason:'TASK-001 falló 3 veces.',startedAt:'now',endedAt:null}});
  render(<FeaturePilotPanel projectId="p" nodes={nodes}/>);
  expect((await screen.findByRole('status')).textContent).toBe('Esperándote · TASK-001 falló 3 veces.');
  fireEvent.click(screen.getByRole('button',{name:'Reanudar piloto'}));
  await waitFor(()=>expect(waiting.commands.resumePilot).toHaveBeenCalledWith('p','feat'));
 });

 it('only offers the API key when the app was started with one',async()=>{
  ipc();
  render(<FeaturePilotPanel projectId="p" nodes={nodes}/>);
  const option=(await screen.findByRole('option',{name:/Clave de API/})) as HTMLOptionElement;
  expect(option.disabled).toBe(true);expect(option.textContent).toContain('ANTHROPIC_API_KEY');
 });
});
