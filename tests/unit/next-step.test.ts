import { describe, expect, it } from 'vitest';
import { nextStep } from '../../src/desktop/presentation/shell/next-step.js';
import type { ActivityItemDto, ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';
import type { GraphNodeView } from '../../src/shared/contracts/graph-view.js';
import type { InceptionActivityDto } from '../../src/shared/contracts/inception-view.js';

const feature:GraphNodeView={id:'f',key:'FEAT-001',type:'FEATURE',label:'Búsqueda',status:'DRAFT',parentId:'m'};
const task=(id:string,key:string,status:string):GraphNodeView=>({id,key,type:'WORK_ITEM',label:`Tarea ${key}`,status,parentId:'f'});
const graph=(...nodes:GraphNodeView[])=>({nodes:[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT' as const,label:'P',status:'ACTIVE'},...nodes]});
const item=(over:Partial<ActivityItemDto>&Pick<ActivityItemDto,'kind'>):ActivityItemDto=>({id:over.kind,at:'2026-11-11T00:00:00Z',title:'Algo',detail:null,needsAttention:true,workItemId:null,executionId:null,featureId:null,changeSetId:null,target:'agents',...over});
const activity=(items:ActivityItemDto[],running:ActivitySummaryDto['running']=[],inception:InceptionActivityDto|null=null):ActivitySummaryDto=>({items,running,attentionCount:items.filter(entry=>entry.needsAttention).length,inception});
const inception=(over:Partial<InceptionActivityDto>):InceptionActivityDto=>({stage:'ASK_GOALS',status:'WAITING_USER',title:'Inicio',detail:'Detalle',needsAttention:true,changeSetId:null,at:'now',...over});

describe('nextStep',()=>{
 it('inception pending: define the project, answer, wait or approve in Inicio, before anything else',()=>{
  expect(nextStep(graph(),activity([],[],inception({stage:'ASK_GOALS',detail:'3 preguntas'})))).toMatchObject({id:'inception-answer',title:'Responde las preguntas del asistente de inicio',detail:'3 preguntas',target:{view:'inception'},tone:'attention'});
  const proposal=item({kind:'PLAN_PROPOSAL',changeSetId:'cs-inception',target:'planning'});
  expect(nextStep(graph(),activity([proposal],[],inception({stage:'PROPOSAL',changeSetId:'cs-inception'})))).toMatchObject({id:'inception-approve',title:'Revisa y aprueba la propuesta',target:{view:'inception'}});
  expect(nextStep(graph(),activity([],[],inception({status:'FAILED',detail:'sin red'})))).toMatchObject({id:'inception-failed',detail:'sin red',target:{view:'inception'}});
  expect(nextStep(graph(),activity([],[],inception({status:'WORKING',needsAttention:false})))).toMatchObject({id:'inception-working',target:{view:'inception'},tone:'neutral'});
  // Una propuesta de Planificar (no la del inicio) sigue yendo a Planificar.
  expect(nextStep(graph(),activity([item({kind:'PLAN_PROPOSAL',changeSetId:'otra'})],[],inception({status:'WORKING',needsAttention:false,changeSetId:'cs-inception'})))).toMatchObject({id:'review-proposal',target:{view:'planning',changeSetId:'otra'}});
 });
 it('without features: start planning, or review a pending proposal',()=>{
  expect(nextStep(graph(),null)).toMatchObject({id:'define-project',title:'Define tu proyecto',target:{view:'inception'}});
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
 it('a finished feature with an unintegrated branch: «Integra FEAT-00X» when the next one depends on it or nothing is left',()=>{
  const second:GraphNodeView={id:'f2',key:'FEAT-002',type:'FEATURE',label:'Listado',status:'DRAFT',parentId:'m'};
  const b=(id:string,key:string,status:string):GraphNodeView=>({...task(id,key,status),parentId:'f2'});
  const depends={id:'e',source:'f2',target:'f',type:'DEPENDS_ON' as const,provenance:'USER' as const};
  const branch=(integratedAt:string|null=null,targetBranch:string|null='main')=>({...activity([]),integrations:[{featureId:'f',branchName:'feature/feat-001',targetBranch,integratedAt}]});
  const nodes=[feature,task('t1','TASK-001','DONE'),task('t2','TASK-002','ARCHIVED'),second,b('t3','TASK-003','READY')];
  // FEAT-002 depends on FEAT-001: integrate before running its tasks.
  expect(nextStep({nodes:graph(...nodes).nodes,edges:[depends]},branch())).toMatchObject({id:'integrate-f',title:'Integra FEAT-001 «Búsqueda» en main',actionLabel:'Integrar FEAT-001',target:{view:'graph',workItemId:'f'},tone:'success',detail:expect.stringMatching(/FEAT-002 depende de ella/)});
  // Independent and work left: keep running tasks.
  expect(nextStep({nodes:graph(...nodes).nodes,edges:[]},branch())).toMatchObject({id:'run-ready'});
  // Nothing left: integrate instead of «Todo cerrado»; unknown base branch reads «la rama principal».
  const done=[feature,task('t1','TASK-001','DONE')];
  expect(nextStep(graph(...done),branch(null,null))).toMatchObject({id:'integrate-f',title:'Integra FEAT-001 «Búsqueda» en la rama principal',detail:expect.stringMatching(/no queda más trabajo/)});
  // Already integrated, no branch, or tasks still open: no suggestion.
  expect(nextStep(graph(...done),branch('2026-11-11T00:00:00Z'))).toMatchObject({id:'all-done'});
  expect(nextStep(graph(...done),activity([]))).toMatchObject({id:'all-done'});
  expect(nextStep({nodes:graph(feature,task('t1','TASK-001','DONE'),task('t2','TASK-002','READY'),second,b('t3','TASK-003','BLOCKED')).nodes,edges:[depends]},branch())).toMatchObject({id:'run-ready',target:{workItemId:'t2'}});
  // Pending decisions still come first.
  expect(nextStep({nodes:graph(...nodes).nodes,edges:[depends]},{...branch(),items:[item({kind:'APPROVAL_PENDING'})]})).toMatchObject({id:'decide'});
 });
});
