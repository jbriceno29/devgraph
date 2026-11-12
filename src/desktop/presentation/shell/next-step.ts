import type { ActivitySummaryDto } from '../../../shared/contracts/activity-view.js';
import type { GraphEdgeView, GraphNodeView } from '../../../shared/contracts/graph-view.js';

export type ShellView = 'activity' | 'graph' | 'planning' | 'agents' | 'documents' | 'inception';
export interface ShellTarget {
  view: ShellView;
  workItemId?: string | null;
  executionId?: string | null;
  changeSetId?: string | null;
}
export interface NextStep {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  target: ShellTarget;
  tone: 'neutral' | 'attention' | 'success';
}

const byKey = (a: GraphNodeView, b: GraphNodeView) => a.key.localeCompare(b.key, 'es', { numeric: true });
const name = (task: GraphNodeView) => `${task.key} «${task.label}»`;

const closed = (status: string) => status === 'DONE' || status === 'ARCHIVED';
/** Feature a la que pertenece una tarea (siguiendo `parentId`). */
const featureOf = (node: GraphNodeView, byId: Map<string, GraphNodeView>) => {
  let current: GraphNodeView | undefined = node;
  for (let depth = 0; current && depth < 16; depth++) {
    if (current.type === 'FEATURE') return current.id;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
};

/**
 * Feature terminada (todas sus tareas hechas o archivadas) con rama sin integrar en su rama base, cuando otra feature
 * pendiente depende de ella o ya no queda trabajo. Usa `activity.integrations` (sin consultas a git).
 */
function pendingIntegration(
  graph: { nodes: GraphNodeView[]; edges?: GraphEdgeView[] },
  activity: ActivitySummaryDto | null,
): NextStep | null {
  const branches = new Map(
    (activity?.integrations ?? []).filter(item => !item.integratedAt).map(item => [item.featureId, item]),
  );
  if (!branches.size) return null;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const tasksOf = new Map<string, GraphNodeView[]>();
  for (const node of graph.nodes)
    if (node.type === 'WORK_ITEM') {
      const feature = featureOf(node, byId);
      if (feature) tasksOf.set(feature, [...(tasksOf.get(feature) ?? []), node]);
    }
  const done = (featureId: string) => {
    const tasks = tasksOf.get(featureId) ?? [];
    return tasks.length > 0 && tasks.every(task => closed(task.status)) && tasks.some(task => task.status === 'DONE');
  };
  const noMoreWork = graph.nodes.every(node => node.type !== 'WORK_ITEM' || closed(node.status));
  const features = graph.nodes.filter(node => node.type === 'FEATURE' && node.status !== 'ARCHIVED').sort(byKey);
  for (const feature of features) {
    const branch = branches.get(feature.id);
    if (!branch || !done(feature.id)) continue;
    const dependent = features.find(
      other =>
        other.id !== feature.id &&
        !done(other.id) &&
        (graph.edges ?? []).some(
          edge => edge.type === 'DEPENDS_ON' && edge.source === other.id && edge.target === feature.id,
        ),
    );
    if (!dependent && !noMoreWork) continue;
    const into = branch.targetBranch ? `en ${branch.targetBranch}` : 'en la rama principal';
    return {
      id: `integrate-${feature.id}`,
      title: `Integra ${feature.key} «${feature.label}» ${into}`,
      detail: dependent
        ? `Sus tareas están hechas y ${dependent.key} depende de ella: integrarla junta su trabajo ${into}.`
        : `Sus tareas están hechas y no queda más trabajo: integrarla junta su trabajo ${into}.`,
      actionLabel: `Integrar ${feature.key}`,
      target: { view: 'graph', workItemId: feature.id },
      tone: 'success',
    };
  }
  return null;
}

/** Recomienda una sola acción a partir del grafo y la bandeja de actividad. Pura: sin IPC ni React. */
export function nextStep(
  graph: { nodes: GraphNodeView[]; edges?: GraphEdgeView[] },
  activity: ActivitySummaryDto | null,
): NextStep {
  const features = graph.nodes.filter(node => node.type === 'FEATURE' && node.status !== 'ARCHIVED');
  const tasks = graph.nodes.filter(node => node.type === 'WORK_ITEM' && node.status !== 'ARCHIVED').sort(byKey);
  const items = activity?.items ?? [];
  const inception = activity?.inception ?? null;
  // La propuesta del inicio también llega como PLAN_PROPOSAL: se revisa en Inicio, no en Planificar.
  const proposal = items.find(
    item =>
      item.needsAttention &&
      item.kind === 'PLAN_PROPOSAL' &&
      !(inception?.changeSetId && item.changeSetId === inception.changeSetId),
  );
  if (inception?.needsAttention)
    return inception.status === 'FAILED'
      ? {
          id: 'inception-failed',
          title: 'El asistente de inicio no pudo terminar',
          detail: inception.detail,
          actionLabel: 'Ver qué pasó',
          target: { view: 'inception' },
          tone: 'attention',
        }
      : inception.stage === 'EXPLORE_UI'
        ? {
            id: 'inception-design',
            title: 'Elige una dirección visual',
            detail: inception.detail,
            actionLabel: 'Ver las propuestas',
            target: { view: 'inception' },
            tone: 'attention',
          }
        : inception.stage === 'PROPOSAL'
          ? {
              id: 'inception-approve',
              title: 'Revisa y aprueba la propuesta',
              detail: inception.detail,
              actionLabel: 'Revisar la propuesta',
              target: { view: 'inception' },
              tone: 'attention',
            }
          : {
              id: 'inception-answer',
              title: 'Responde las preguntas del asistente de inicio',
              detail: inception.detail,
              actionLabel: 'Responder',
              target: { view: 'inception' },
              tone: 'attention',
            };
  if (!features.length)
    return proposal
      ? {
          id: 'review-proposal',
          title: 'Tienes una propuesta de plan sin revisar',
          detail: 'Revísala en Planificar y aplícala para crear tus features y tareas.',
          actionLabel: 'Revisar la propuesta',
          target: { view: 'planning', changeSetId: proposal.changeSetId },
          tone: 'attention',
        }
      : inception?.status === 'WORKING'
        ? {
            id: 'inception-working',
            title: 'El asistente está preparando tu proyecto',
            detail: inception.detail,
            actionLabel: 'Ver el progreso',
            target: { view: 'inception' },
            tone: 'neutral',
          }
        : {
            id: 'define-project',
            title: 'Define tu proyecto',
            detail:
              'El asistente te hace unas preguntas y propone objetivo, stack y plan inicial; tú apruebas antes de crear nada.',
            actionLabel: 'Definir el proyecto',
            target: { view: 'inception' },
            tone: 'neutral',
          };
  if (proposal)
    return {
      id: 'review-proposal',
      title: 'Un agente propuso cambios al plan',
      detail: proposal.title,
      actionLabel: 'Revisar la propuesta',
      target: { view: 'planning', changeSetId: proposal.changeSetId },
      tone: 'attention',
    };
  const decision = items.find(
    item => item.needsAttention && (item.kind === 'APPROVAL_PENDING' || item.kind === 'PILOT_WAITING'),
  );
  if (decision)
    return {
      id: 'decide',
      title: decision.kind === 'APPROVAL_PENDING' ? 'Un agente espera tu permiso' : 'El piloto espera tu decisión',
      detail: decision.title,
      actionLabel: 'Ver en Actividad',
      target: { view: 'activity' },
      tone: 'attention',
    };
  const integrate = pendingIntegration(graph, activity);
  if (integrate) return integrate;
  const running = tasks.some(task => task.status === 'IN_PROGRESS') || (activity?.running.length ?? 0) > 0;
  const ready = tasks.find(task => task.status === 'READY');
  if (ready && !running)
    return {
      id: 'run-ready',
      title: `Ejecuta ${name(ready)} con un agente`,
      detail: 'Está lista y no hay nada corriendo ahora.',
      actionLabel: `Ejecutar ${ready.key}`,
      target: { view: 'agents', workItemId: ready.id },
      tone: 'neutral',
    };
  const attention = items.filter(item => item.needsAttention);
  if (attention.length)
    return {
      id: 'attention',
      title:
        attention.length === 1 ? 'Una cosa requiere tu atención' : `${attention.length} cosas requieren tu atención`,
      detail: attention[0]!.title,
      actionLabel: 'Ver en Actividad',
      target: { view: 'activity' },
      tone: 'attention',
    };
  if (tasks.length && tasks.every(task => task.status === 'DONE'))
    return {
      id: 'all-done',
      title: 'Todo cerrado. Planifica la siguiente feature',
      detail: `Las ${tasks.length} tareas del proyecto están terminadas.`,
      actionLabel: 'Planificar la siguiente feature',
      target: { view: 'planning' },
      tone: 'success',
    };
  if (running) {
    const task = tasks.find(item => item.status === 'IN_PROGRESS');
    return {
      id: 'running',
      title: task ? `${name(task)} está en curso` : 'Un agente está trabajando',
      detail: 'Sigue su progreso; te avisaremos cuando termine.',
      actionLabel: 'Ver el progreso',
      target: { view: 'agents', workItemId: task?.id ?? null },
      tone: 'neutral',
    };
  }
  const draft = tasks.find(task => task.status === 'DRAFT');
  if (draft && !ready)
    return {
      id: 'mark-ready',
      title: `Marca como lista ${name(draft)} para poder ejecutarla`,
      detail: 'Revisa su alcance en el inspector y cambia su estado a «Lista».',
      actionLabel: `Abrir ${draft.key} en el grafo`,
      target: { view: 'graph', workItemId: draft.id },
      tone: 'neutral',
    };
  if (!tasks.length)
    return {
      id: 'break-down',
      title: 'Desglosa tus features en tareas',
      detail: 'Pide al planificador las tareas de cada feature para poder ejecutarlas.',
      actionLabel: 'Ir a Planificar',
      target: { view: 'planning' },
      tone: 'neutral',
    };
  return {
    id: 'review',
    title: 'Revisa el estado de las tareas',
    detail: 'Hay tareas bloqueadas o en revisión.',
    actionLabel: 'Ver en Actividad',
    target: { view: 'activity' },
    tone: 'neutral',
  };
}
