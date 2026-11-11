// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionReview } from '../../src/desktop/presentation/agents/ExecutionReview.js';
import { ExecutionPolicyForm } from '../../src/desktop/presentation/agents/ExecutionPolicyForm.js';
import { ContextualInspector } from '../../src/desktop/presentation/inspector/ContextualInspector.js';
import type { AgentExecutionDto, ExecutionDetailDto } from '../../src/shared/contracts/agent-view.js';
import type { EntityInspectorDto } from '../../src/shared/contracts/ipc-contracts.js';

afterEach(cleanup);
const execution:AgentExecutionDto={id:'run-1',projectId:'p',workItemId:'t1',profileId:'dev',providerId:'provider',sessionId:null,contextSnapshotId:'snap',status:'COMPLETED',modelUsed:'claude-haiku-5-5',initialCommit:'aaaaaaaa1',finalCommit:'bbbbbbbb2',branchOrWorktree:'/wt',baseBranch:'feature/feat-001-tareas',executionBranch:'graphdev/task-001-run',revisionOf:null,reviewStatus:null,reviewNote:null,mergedCommit:null,reviewedAt:null,resultSummary:'Diff audit passed.',startedAt:'now',completedAt:'now'};
const detail:ExecutionDetailDto={execution,taskStatus:'IN_REVIEW',files:[{path:'src/tasks.js',changeType:'ADDED',additions:40,deletions:0,patch:'+export const tasks = [];'},{path:'.env',changeType:'ADDED',additions:0,deletions:0,patch:null}],testLog:'$ node --test\nℹ pass 8',deniedActions:[{toolName:'Bash',target:'npm test | tail',reason:'mode'}],canAccept:true,canRequestChanges:true};
function ipc(overrides:Record<string,unknown>={}){
 const value={commands:{acceptExecution:vi.fn(async()=>({execution:{...execution,reviewStatus:'ACCEPTED',mergedCommit:'cccccccc3',branchOrWorktree:null},merged:true,conflict:null})),requestExecutionChanges:vi.fn(async()=>({...execution,id:'run-2',revisionOf:'run-1',status:'RUNNING'})),updateExecutionPolicy:vi.fn(async(_p:string,policy:unknown)=>policy)},queries:{getExecutionDetail:vi.fn(async()=>detail),getExecutionPolicy:vi.fn(async()=>({writablePaths:['src/**','tests/**'],readonlyPaths:[],deniedPaths:['.env*'],allowedCommands:[]}))},...overrides};
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
  await waitFor(()=>expect(client.commands.updateExecutionPolicy).toHaveBeenCalledWith('p',{writablePaths:['src/**','tests/**'],readonlyPaths:[],deniedPaths:['.env*'],allowedCommands:['node --test','npm run lint'],maxExecutionMinutes:30}));
  expect((await screen.findByRole('status')).textContent).toBe('Política guardada.');
 });

 it('shows the server error when a command is rejected',async()=>{
  ipc({commands:{updateExecutionPolicy:vi.fn(async()=>{throw new Error('Comando no permitido: npm test | tail.');})}});
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
 it('explains why an execution-owned status cannot be changed by hand',()=>{
  render(<ContextualInspector details={details('IN_PROGRESS',[])} contextPackage={null} contextLoading={false} contextError={null} onRefreshContext={vi.fn()} onChangeStatus={vi.fn()}/>);
  expect(screen.getByText('Hay una ejecución en curso; el estado lo controla la ejecución.')).toBeTruthy();
 });
});
