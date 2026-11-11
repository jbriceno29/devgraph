import type { ActivitySummaryDto } from '../../../shared/contracts/activity-view.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';

export type ShellView='activity'|'graph'|'planning'|'agents'|'documents';
export interface ShellTarget { view:ShellView; workItemId?:string|null; executionId?:string|null; changeSetId?:string|null }
export interface NextStep { id:string; title:string; detail:string; actionLabel:string; target:ShellTarget; tone:'neutral'|'attention'|'success' }

const byKey=(a:GraphNodeView,b:GraphNodeView)=>a.key.localeCompare(b.key,'es',{numeric:true});
const name=(task:GraphNodeView)=>`${task.key} «${task.label}»`;

/** Recomienda una sola acción a partir del grafo y la bandeja de actividad. Pura: sin IPC ni React. */
export function nextStep(graph:{nodes:GraphNodeView[]}, activity:ActivitySummaryDto|null):NextStep {
 const features=graph.nodes.filter(node=>node.type==='FEATURE'&&node.status!=='ARCHIVED');
 const tasks=graph.nodes.filter(node=>node.type==='WORK_ITEM'&&node.status!=='ARCHIVED').sort(byKey);
 const items=activity?.items??[];
 const proposal=items.find(item=>item.needsAttention&&item.kind==='PLAN_PROPOSAL');
 if(!features.length) return proposal
  ?{id:'review-proposal',title:'Tienes una propuesta de plan sin revisar',detail:'Revísala en Planificar y aplícala para crear tus features y tareas.',actionLabel:'Revisar la propuesta',target:{view:'planning',changeSetId:proposal.changeSetId},tone:'attention'}
  :{id:'start',title:'Empieza describiendo qué quieres construir',detail:'El planificador propone módulos, features y tareas; tú decides qué aplicar.',actionLabel:'Ir a Planificar',target:{view:'planning'},tone:'neutral'};
 if(proposal) return {id:'review-proposal',title:'Un agente propuso cambios al plan',detail:proposal.title,actionLabel:'Revisar la propuesta',target:{view:'planning',changeSetId:proposal.changeSetId},tone:'attention'};
 const decision=items.find(item=>item.needsAttention&&(item.kind==='APPROVAL_PENDING'||item.kind==='PILOT_WAITING'));
 if(decision) return {id:'decide',title:decision.kind==='APPROVAL_PENDING'?'Un agente espera tu permiso':'El piloto espera tu decisión',detail:decision.title,actionLabel:'Ver en Actividad',target:{view:'activity'},tone:'attention'};
 const running=tasks.some(task=>task.status==='IN_PROGRESS')||(activity?.running.length??0)>0;
 const ready=tasks.find(task=>task.status==='READY');
 if(ready&&!running) return {id:'run-ready',title:`Ejecuta ${name(ready)} con un agente`,detail:'Está lista y no hay nada corriendo ahora.',actionLabel:`Ejecutar ${ready.key}`,target:{view:'agents',workItemId:ready.id},tone:'neutral'};
 const attention=items.filter(item=>item.needsAttention);
 if(attention.length) return {id:'attention',title:attention.length===1?'Una cosa requiere tu atención':`${attention.length} cosas requieren tu atención`,detail:attention[0]!.title,actionLabel:'Ver en Actividad',target:{view:'activity'},tone:'attention'};
 if(tasks.length&&tasks.every(task=>task.status==='DONE')) return {id:'all-done',title:'Todo cerrado. Planifica la siguiente feature',detail:`Las ${tasks.length} tareas del proyecto están terminadas.`,actionLabel:'Planificar la siguiente feature',target:{view:'planning'},tone:'success'};
 if(running){const task=tasks.find(item=>item.status==='IN_PROGRESS');return {id:'running',title:task?`${name(task)} está en curso`:'Un agente está trabajando',detail:'Sigue su progreso; te avisaremos cuando termine.',actionLabel:'Ver el progreso',target:{view:'agents',workItemId:task?.id??null},tone:'neutral'};}
 const draft=tasks.find(task=>task.status==='DRAFT');
 if(draft&&!ready) return {id:'mark-ready',title:`Marca como lista ${name(draft)} para poder ejecutarla`,detail:'Revisa su alcance en el inspector y cambia su estado a «Lista».',actionLabel:`Abrir ${draft.key} en el grafo`,target:{view:'graph',workItemId:draft.id},tone:'neutral'};
 if(!tasks.length) return {id:'break-down',title:'Desglosa tus features en tareas',detail:'Pide al planificador las tareas de cada feature para poder ejecutarlas.',actionLabel:'Ir a Planificar',target:{view:'planning'},tone:'neutral'};
 return {id:'review',title:'Revisa el estado de las tareas',detail:'Hay tareas bloqueadas o en revisión.',actionLabel:'Ver en Actividad',target:{view:'activity'},tone:'neutral'};
}
