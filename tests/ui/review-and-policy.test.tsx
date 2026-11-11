// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionReview } from '../../src/desktop/presentation/agents/ExecutionReview.js';
import { ExecutionPolicyForm } from '../../src/desktop/presentation/agents/ExecutionPolicyForm.js';
import { ContextualInspector } from '../../src/desktop/presentation/inspector/ContextualInspector.js';
import type { AgentExecutionDto, ExecutionDetailDto } from '../../src/shared/contracts/agent-view.js';
import type { EntityInspectorDto } from '../../src/shared/contracts/ipc-contracts.js';

afterEach(cleanup);
const execution:AgentExecutionDto={id:'run-1',projectId:'p',workItemId:'t1',coveredWorkItemIds:['t1'],profileId:'dev',providerId:'provider',sessionId:null,contextSnapshotId:'snap',status:'COMPLETED',modelUsed:'claude-haiku-5-5',initialCommit:'aaaaaaaa1',finalCommit:'bbbbbbbb2',branchOrWorktree:'/wt',baseBranch:'feature/feat-001-tareas',executionBranch:'graphdev/task-001-run',revisionOf:null,reviewStatus:null,reviewNote:null,mergedCommit:null,reviewedAt:null,resultSummary:'Diff audit passed.',startedAt:'now',completedAt:'now'};
const detail:ExecutionDetailDto={execution,taskStatus:'IN_REVIEW',files:[{path:'src/tasks.js',changeType:'ADDED',additions:40,deletions:0,patch:'+export const tasks = [];'},{path:'.env',changeType:'ADDED',additions:0,deletions:0,patch:null}],testLog:'$ node --test\nℹ pass 8',deniedActions:[{toolName:'Bash',target:'npm test | tail',reason:'mode'}],canAccept:true,canRequestChanges:true};
function ipc(overrides:Record<string,unknown>={}){
 const value={commands:{acceptExecution:vi.fn(async()=>({execution:{...execution,reviewStatus:'ACCEPTED',mergedCommit:'cccccccc3',branchOrWorktree:null},merged:true,conflict:null})),requestExecutionChanges:vi.fn(async()=>({...execution,id:'run-2',revisionOf:'run-1',status:'RUNNING'})),setFeatureAutonomy:vi.fn(),startPilot:vi.fn(),stopPilot:vi.fn(),resumePilot:vi.fn(),setAuthMode:vi.fn(),exportFeatureReport:vi.fn(),updateExecutionPolicy:vi.fn(async(_p:string,policy:unknown)=>policy)},queries:{getExecutionDetail:vi.fn(async()=>detail),getFeaturePilot:vi.fn(),getContextFlow:vi.fn(async()=>({executionId:null,snapshotId:null,sources:[],conventions:[]})),getFeatureReport:vi.fn(),getExecutionPolicy:vi.fn(async()=>({writablePaths:['src/**','tests/**'],readonlyPaths:[],deniedPaths:['.env*'],allowedCommands:[]}))},...overrides};
 Object.defineProperty(window,'workspaceIpc',{configurable:true,value});return value;
}

describe('ExecutionReview',()=>{
 it('shows files, denied actions and the test log, and accepts into the feature branch',async()=>{
  const client=ipc();const onChanged=vi.fn();
  render(<ExecutionReview execution={execution} models={['haiku','sonnet']} defaultModel="sonnet" onChanged={onChanged}/>);
  expect(await screen.findByText('src/tasks.js')).toBeTruthy();
  expect(screen.getByText('Contenido omitido (ruta prohibida por la política).')).toBeTruthy();
  expect(screen.getByText('Acciones denegadas (1)')).toBeTruthy();
  expect(screen.getByText('Log de verificación')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Aceptar e integrar en feature/feat-001-tareas'}));
  await waitFor(()=>expect(client.commands.acceptExecution).toHaveBeenCalledWith('run-1'));
  expect((await screen.findByRole('status')).textContent).toContain('Integrada en feature/feat-001-tareas (commit cccccccc)');
  expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({reviewStatus:'ACCEPTED'}));
 });

 it('explains a merge conflict with the files involved',async()=>{
  ipc({commands:{acceptExecution:vi.fn(async()=>({execution:{...execution,reviewStatus:'MERGE_CONFLICT'},merged:false,conflict:{reason:'CONFLICT',detail:'Conflicto al integrar en feature/feat-001-tareas.',files:['src/base.ts']}}))}});
  render(<ExecutionReview execution={execution} models={[]} defaultModel={null} onChanged={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:/Aceptar e integrar/}));
  const alert=await screen.findByRole('alert');
  expect(alert.textContent).toContain('Conflicto al integrar');expect(alert.textContent).toContain('src/base.ts');
 });

 it('requests changes with the feedback and the chosen model',async()=>{
  const client=ipc();const onChanged=vi.fn();
  render(<ExecutionReview execution={execution} models={['haiku','sonnet']} defaultModel="sonnet" onChanged={onChanged}/>);
  const button=await screen.findByRole('button',{name:'Pedir ajustes'});
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('¿Qué hay que ajustar?'),{target:{value:'Valida títulos largos.'}});
  fireEvent.change(screen.getByLabelText('Modelo para los ajustes'),{target:{value:'haiku'}});
  fireEvent.click(button);
  await waitFor(()=>expect(client.commands.requestExecutionChanges).toHaveBeenCalledWith({executionId:'run-1',feedback:'Valida títulos largos.',model:'haiku'}));
  await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({id:'run-2'})));
 });

 it('explains a grouped run: which tasks it covers and what accepting or requesting changes does to them',async()=>{
  ipc();
  render(<ExecutionReview execution={{...execution,coveredWorkItemIds:['t1','t2']}} tasks={[{id:'t1',key:'TASK-001',label:'Crear'},{id:'t2',key:'TASK-002',label:'Listar'}]} models={[]} defaultModel={null} onChanged={vi.fn()}/>);
  const banner=(await screen.findByText(/Ejecución agrupada/)).closest('p')!;
  expect(banner.textContent).toContain('cierra 2 tareas a la vez (TASK-001 «Crear», TASK-002 «Listar»)');
  expect(banner.textContent).toContain('pedir ajustes relanza el grupo entero');
  cleanup();
  ipc();
  render(<ExecutionReview execution={execution} models={[]} defaultModel={null} onChanged={vi.fn()}/>);
  expect(await screen.findByText('src/tasks.js')).toBeTruthy();
  expect(screen.queryByText(/Ejecución agrupada/)).toBeNull();
 });

 it('offers no actions once the run was reviewed',async()=>{
  ipc({queries:{getExecutionDetail:vi.fn(async()=>({...detail,canAccept:false,canRequestChanges:false}))}});
  render(<ExecutionReview execution={{...execution,reviewStatus:'ACCEPTED',mergedCommit:'cccccccc3'}} models={[]} defaultModel={null} onChanged={vi.fn()}/>);
  expect(await screen.findByText('Aceptada e integrada')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Aceptar/})).toBeNull();expect(screen.queryByRole('button',{name:'Pedir ajustes'})).toBeNull();
 });
});

describe('ExecutionPolicyForm',()=>{
 it('loads the policy, saves one entry per line and warns when no checks are configured',async()=>{
  const client=ipc();
  render(<ExecutionPolicyForm projectId="p"/>);
  const commands=await screen.findByLabelText('Comandos de verificación') as HTMLTextAreaElement;
  expect((screen.getByLabelText('Rutas escribibles') as HTMLTextAreaElement).value).toBe('src/**\ntests/**');
  fireEvent.change(commands,{target:{value:'node --test\n\n  npm run lint  '}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar política'}));
  await waitFor(()=>expect(client.commands.updateExecutionPolicy).toHaveBeenCalledWith('p',{writablePaths:['src/**','tests/**'],readonlyPaths:[],deniedPaths:['.env*'],allowedCommands:['node --test','npm run lint'],maxExecutionMinutes:30,maxTurns:0,decisionPolicy:{rules:{NEW_TASK:'AUTO',TASK_DEPENDENCY:'AUTO',TASK_STATUS:'ASK',DECISION_RECORD:'ASK',SCOPE_CHANGE:'ASK'},maxAutoTasksPerFeature:5}}));
  expect((await screen.findByRole('status')).textContent).toBe('Política guardada.');
 });

 it('saves the turn limit and rejects an invalid one',async()=>{
  const client=ipc();
  render(<ExecutionPolicyForm projectId="p"/>);
  const turns=await screen.findByLabelText('Tope de turnos por ejecución') as HTMLInputElement;
  expect(turns.value).toBe('0');
  fireEvent.change(turns,{target:{value:'-3'}});fireEvent.click(screen.getByRole('button',{name:'Guardar política'}));
  expect((await screen.findByRole('alert')).textContent).toContain('0 (sin límite) y 1000');
  fireEvent.change(turns,{target:{value:'40'}});fireEvent.click(screen.getByRole('button',{name:'Guardar política'}));
  await waitFor(()=>expect(client.commands.updateExecutionPolicy).toHaveBeenCalledWith('p',expect.objectContaining({maxTurns:40})));
 });

 it('uses the default decision policy when the project has none',async()=>{
  ipc();
  render(<ExecutionPolicyForm projectId="p"/>);
  expect(await screen.findByRole('group',{name:'Decisiones del agente'})).toBeTruthy();
  expect((screen.getByLabelText('Agregar tareas dentro de la misma feature') as HTMLSelectElement).value).toBe('AUTO');
  expect((screen.getByLabelText('Registrar decisiones de arquitectura (ADR)') as HTMLSelectElement).value).toBe('ASK');
  expect((screen.getByLabelText('Máximo de tareas automáticas por feature') as HTMLInputElement).value).toBe('5');
 });

 it('loads the received decision policy and saves the changed category and maximum',async()=>{
  const decisionPolicy={rules:{NEW_TASK:'ASK',TASK_DEPENDENCY:'AUTO',TASK_STATUS:'AUTO',DECISION_RECORD:'ASK',SCOPE_CHANGE:'ASK'},maxAutoTasksPerFeature:12};
  const client=ipc();
  (client.queries as Record<string,unknown>).getExecutionPolicy=vi.fn(async()=>({writablePaths:['src/**'],readonlyPaths:[],deniedPaths:[],allowedCommands:['npm test'],decisionPolicy}));
  render(<ExecutionPolicyForm projectId="p"/>);
  const scope=await screen.findByLabelText(/Cambiar el alcance/) as HTMLSelectElement;
  expect((screen.getByLabelText('Agregar tareas dentro de la misma feature') as HTMLSelectElement).value).toBe('ASK');
  expect((screen.getByLabelText(/Cambiar el estado de tareas/) as HTMLSelectElement).value).toBe('AUTO');
  const max=screen.getByLabelText('Máximo de tareas automáticas por feature') as HTMLInputElement;
  expect(max.value).toBe('12');
  fireEvent.change(scope,{target:{value:'AUTO'}});
  fireEvent.change(max,{target:{value:'3'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar política'}));
  await waitFor(()=>expect(client.commands.updateExecutionPolicy).toHaveBeenCalledWith('p',expect.objectContaining({decisionPolicy:{rules:{...decisionPolicy.rules,SCOPE_CHANGE:'AUTO'},maxAutoTasksPerFeature:3}})));
 });

 it('rejects a maximum of automatic tasks out of range without saving',async()=>{
  const client=ipc();
  render(<ExecutionPolicyForm projectId="p"/>);
  fireEvent.change(await screen.findByLabelText('Máximo de tareas automáticas por feature'),{target:{value:'51'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar política'}));
  expect((await screen.findByRole('alert')).textContent).toContain('entre 0 y 50');
  expect(client.commands.updateExecutionPolicy).not.toHaveBeenCalled();
 });

 it('shows the server error when a command is rejected',async()=>{
  ipc({commands:{setFeatureAutonomy:vi.fn(),startPilot:vi.fn(),stopPilot:vi.fn(),resumePilot:vi.fn(),setAuthMode:vi.fn(),exportFeatureReport:vi.fn(),updateExecutionPolicy:vi.fn(async()=>{throw new Error('Comando no permitido: npm test | tail.');})}});
  render(<ExecutionPolicyForm projectId="p"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Guardar política'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Comando no permitido');
 });
});

describe('Inspector status control',()=>{
 const details=(status:string,allowed:string[]):EntityInspectorDto=>({entity:{id:'t1',key:'TASK-001',type:'WORK_ITEM',label:'Task',status,summary:''},attributes:{},relationships:[],executionHistory:[],allowedStatusChanges:allowed});
 it('offers only the allowed manual changes and reports a refusal',async()=>{
  const onChange=vi.fn(async()=>{throw new Error('TASK-001 depende de tareas sin terminar: TASK-000 (READY).');});
  render(<ContextualInspector details={details('DRAFT',['READY','ARCHIVED'])} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()} onChangeStatus={onChange}/>);
  const select=screen.getByLabelText('Nuevo estado') as HTMLSelectElement;
  expect([...select.options].map(option=>option.value)).toEqual(['READY','ARCHIVED']);
  fireEvent.click(screen.getByRole('button',{name:'Cambiar estado'}));
  await waitFor(()=>expect(onChange).toHaveBeenCalledWith('READY'));
  expect((await screen.findByRole('alert')).textContent).toContain('depende de tareas sin terminar');
 });
 it('speaks plain Spanish: no ids, readable attributes, relations and status options',()=>{
  const uuid='0d5b6c1e-1111-4222-8333-444455556666';
  const info:EntityInspectorDto={entity:{id:uuid,key:'TASK-001',type:'WORK_ITEM',label:'Task',status:'DRAFT',summary:'',parentId:'feat'},attributes:{entity_id:uuid,featureId:'feat',acceptance_criteria:['Valida títulos','Guarda'],meta:{owner:'Ana',urgent:true}},relationships:[{id:'r',sourceId:'t0',sourceLabel:'Preparar base',targetId:uuid,targetLabel:'Task',type:'DEPENDS_ON',direction:'INCOMING',provenance:'USER'}],executionHistory:[{id:uuid,status:'COMPLETED',startedAt:'2026-11-10T10:00:00Z',completedAt:'2026-11-10T10:05:00Z',resultSummary:'Listo.'}],allowedStatusChanges:['READY']};
  const {container}=render(<ContextualInspector details={info} nodes={[{id:'feat',key:'FEAT-001',type:'FEATURE',label:'Gestión de tareas',status:'DRAFT'}]} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()} onChangeStatus={vi.fn()}/>);
  expect(container.textContent).not.toContain(uuid);expect(container.textContent).not.toMatch(/WORK_ITEM|DEPENDS|COMPLETED|[{}"]/);
  expect(screen.getByText('Pertenece a').nextElementSibling?.textContent).toBe('Gestión de tareas');
  expect(screen.getByText('Criterios de aceptación')).toBeTruthy();expect(screen.getByText('Valida títulos')).toBeTruthy();expect(container.textContent).toContain('Urgent: Sí');
  expect(screen.getByText('Requerida por')).toBeTruthy();expect(screen.getByText('Terminada')).toBeTruthy();
  expect([...(screen.getByLabelText('Nuevo estado') as HTMLSelectElement).options].map(option=>option.textContent)).toEqual(['Lista']);
  expect(screen.getByRole('complementary',{name:'Inspector'}).className).toContain('clamp(');
 });
 it('offers the next step for a task only when the shell provides it',()=>{
  const onOpenAgents=vi.fn();
  const {rerender}=render(<ContextualInspector details={details('READY',[])} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Ejecutar esta tarea'})).toBeNull();
  rerender(<ContextualInspector details={details('READY',[])} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()} onOpenAgents={onOpenAgents}/>);
  fireEvent.click(screen.getByRole('button',{name:'Ejecutar esta tarea'}));expect(onOpenAgents).toHaveBeenLastCalledWith('t1');
  const review={...details('IN_REVIEW',[]),executionHistory:[{id:'old',status:'FAILED',startedAt:'2026-11-09T10:00:00Z',completedAt:null,resultSummary:null},{id:'new',status:'COMPLETED',startedAt:'2026-11-10T10:00:00Z',completedAt:null,resultSummary:null}]};
  rerender(<ContextualInspector details={review} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()} onOpenAgents={onOpenAgents}/>);
  fireEvent.click(screen.getByRole('button',{name:'Revisar resultado'}));expect(onOpenAgents).toHaveBeenLastCalledWith('t1','new');
 });
 it('explains why an execution-owned status cannot be changed by hand',()=>{
  render(<ContextualInspector details={details('IN_PROGRESS',[])} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()} onChangeStatus={vi.fn()}/>);
  expect(screen.getByText('Hay una ejecución en curso; el estado lo controla la ejecución.')).toBeTruthy();
 });
});
