import { describe, expect, it } from 'vitest';
import { nextStep } from '../../src/desktop/presentation/shell/next-step.js';
import type { ActivityItemDto, ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';
import type { GraphNodeView } from '../../src/shared/contracts/graph-view.js';

const feature:GraphNodeView={id:'f',key:'FEAT-001',type:'FEATURE',label:'Búsqueda',status:'DRAFT',parentId:'m'};
const task=(id:string,key:string,status:string):GraphNodeView=>({id,key,type:'WORK_ITEM',label:`Tarea ${key}`,status,parentId:'f'});
const graph=(...nodes:GraphNodeView[])=>({nodes:[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'P',status:'ACTIVE'},...nodes]});
const item=(over:Partial<ActivityItemDto>&Pick<ActivityItemDto,'kind'>):ActivityItemDto=>({id:over.kind,at:'2026-11-11T00:00:00Z',title:'Algo',detail:null,needsAttention:true,workItemId:null,executionId:null,featureId:null,changeSetId:null,target:'agents',...over});
const activity=(items:ActivityItemDto[],running:ActivitySummaryDto['running']=[]):ActivitySummaryDto=>({items,running,attentionCount:items.filter(entry=>entry.needsAttention).length});

describe('nextStep',()=>{
 it('without features: start planning, or review a pending proposal',()=>{
  expect(nextStep(graph(),null)).toMatchObject({id:'start',title:'Empieza describiendo qué quieres construir',target:{view:'planning'}});
  expect(nextStep(graph(),activity([item({kind:'PLAN_PROPOSAL',changeSetId:'cs',target:'planning'})]))).toMatchObject({id:'review-proposal',target:{view:'planning',changeSetId:'cs'}});
 });
 it('pending proposals go to Planificar and pending decisions to Actividad, before anything else',()=>{
  const ready=task('t1','TASK-001','READY');
  expect(nextStep(graph(feature,ready),activity([item({kind:'PLAN_PROPOSAL',title:'Propuesta: X',changeSetId:'cs'})]))).toMatchObject({id:'review-proposal',detail:'Propuesta: X',target:{view:'planning',changeSetId:'cs'},tone:'attention'});
  expect(nextStep(graph(feature,ready),activity([item({kind:'APPROVAL_PENDING'})]))).toMatchObject({id:'decide',title:'Un agente espera tu permiso',target:{view:'activity'}});
  expect(nextStep(graph(feature,ready),activity([item({kind:'PILOT_WAITING'})]))).toMatchObject({id:'decide',title:'El piloto espera tu decisión'});
 });
 it('READY tasks with nothing running: run the first one by key with an agent',()=>{
  const step=nextStep(graph(feature,task('t3','TASK-010','READY'),task('t2','TASK-002','READY'),task('t1','TASK-001','DONE')),activity([]));
  expect(step).toMatchObject({id:'run-ready',title:'Ejecuta TASK-002 «Tarea TASK-002» con un agente',actionLabel:'Ejecutar TASK-002',target:{view:'agents',workItemId:'t2'}});
 });
 it('attention items (reviews, failures) go to Actividad when nothing is ready to run',()=>{
  expect(nextStep(graph(feature,task('t1','TASK-001','IN_REVIEW')),activity([item({kind:'TASK_IN_REVIEW'}),item({kind:'TASK_FAILED',id:'x'})]))).toMatchObject({id:'attention',title:'2 cosas requieren tu atención',target:{view:'activity'}});
  expect(nextStep(graph(feature,task('t1','TASK-001','READY'),task('t2','TASK-002','IN_PROGRESS')),activity([item({kind:'TASK_IN_REVIEW'})]))).toMatchObject({id:'attention',title:'Una cosa requiere tu atención'});
 });
 it('everything DONE: plan the next feature',()=>{
  expect(nextStep(graph(feature,task('t1','TASK-001','DONE'),task('t2','TASK-002','ARCHIVED')),activity([item({kind:'TASK_DONE',needsAttention:false})]))).toMatchObject({id:'all-done',title:'Todo cerrado. Planifica la siguiente feature',target:{view:'planning'},tone:'success'});
 });
 it('something running and nothing else to do: follow its progress',()=>{
  expect(nextStep(graph(feature,task('t1','TASK-001','IN_PROGRESS'),task('t2','TASK-002','READY')),activity([]))).toMatchObject({id:'running',target:{view:'agents',workItemId:'t1'}});
  expect(nextStep(graph(feature,task('t2','TASK-002','DONE'),task('t3','TASK-003','DRAFT')),activity([],[{workItemKey:'TASK-009',title:'x'}]))).toMatchObject({id:'running',title:'Un agente está trabajando'});
 });
 it('DRAFT tasks without READY ones: mark the first as ready from the graph',()=>{
  expect(nextStep(graph(feature,task('t2','TASK-002','DRAFT'),task('t1','TASK-001','DONE')),null)).toMatchObject({id:'mark-ready',title:'Marca como lista TASK-002 «Tarea TASK-002» para poder ejecutarla',target:{view:'graph',workItemId:'t2'}});
 });
 it('features without tasks, or only blocked work: break down or review',()=>{
  expect(nextStep(graph(feature),null)).toMatchObject({id:'break-down',target:{view:'planning'}});
  expect(nextStep(graph(feature,task('t1','TASK-001','BLOCKED')),null)).toMatchObject({id:'review',target:{view:'activity'}});
 });
});
