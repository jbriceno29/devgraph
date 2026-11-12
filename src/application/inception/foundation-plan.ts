import type { ChangeOperation } from '../../domain/knowledge/change-set.js';
import { UI_SPEC_PATH, UI_SPEC_SECTIONS } from '../../shared/ui-spec.js';
import type { InceptionFeatureDto, InceptionProposalDto } from '../../shared/contracts/inception-view.js';

type Op<T extends ChangeOperation['type']> = Extract<ChangeOperation, { type: T }>;
const FOUNDATION = /fundaci[oó]n|foundation/i;
/** Decision 5: the scaffold never installs dependencies nor runs package scripts; the user installs. */
export const NO_INSTALL_RULE = 'No instales dependencias ni ejecutes scripts de paquetes ni generadores (npm install, npx, pip install, create-*, etc.): crea los archivos a mano. Si el stack necesita dependencias externas, déjalas anotadas en el README para que las instale el usuario.';
const NO_INSTALL_CRITERION = 'No se instaló ninguna dependencia ni se ejecutaron scripts de paquetes o generadores.';
const KEPT: ReadonlySet<ChangeOperation['type']> = new Set(['SET_PROJECT_PROFILE', 'CREATE_MODULE', 'CREATE_FEATURE', 'CREATE_REQUIREMENT', 'CREATE_WORK_ITEM', 'CREATE_DECISION_RECORD', 'UPSERT_ARTIFACT', 'CREATE_RELATIONSHIP']);

/**
 * Turns the engine's draft into the inception proposal, deterministically: only creations on a greenfield graph,
 * modules under the root, flat tasks, the no-install rule in the scaffold task, «Fundación» as prerequisite of every
 * other feature, feature dependencies mirrored on tasks (so no task starts before its prerequisites), and the initial
 * statuses (the scaffold READY, the rest BLOCKED). `problems` lists what the draft lacks; the user revises it then.
 */
export function buildFoundationPlan(operations: ChangeOperation[], rootId: string, options: { uiSpec?: boolean } = {}): { operations: ChangeOperation[]; problems: string[] } {
  const problems: string[] = [];
  const ops = operations.filter(op => KEPT.has(op.type) && !(op.type === 'UPSERT_ARTIFACT' && op.entityId && !op.tempId)).map(op => ({ ...op })) as ChangeOperation[];
  for (const op of ops) if (op.type === 'CREATE_MODULE' && !op.parentId) op.parentId = rootId;
  const features = ops.filter((op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE');
  const tasks = ops.filter((op): op is Op<'CREATE_WORK_ITEM'> => op.type === 'CREATE_WORK_ITEM');
  const featureIds = new Set(features.map(feature => feature.tempId));
  // Flat tasks: a subtask moves under its parent's feature.
  const byId = new Map(tasks.map(task => [task.tempId, task]));
  for (const task of tasks) { let parent = task.parentId, depth = 0; while (byId.has(parent) && depth++ < 8) parent = byId.get(parent)!.parentId; task.parentId = parent; }
  if (ops.filter(op => op.type === 'SET_PROJECT_PROFILE').length !== 1) problems.push('La propuesta debe fijar el perfil del proyecto (objetivo, alcance, stack, reglas y verificación) exactamente una vez.');
  const decision = ops.find((op): op is Op<'CREATE_DECISION_RECORD'> => op.type === 'CREATE_DECISION_RECORD');
  if (!decision) problems.push('Falta el ADR del stack con sus alternativas.');
  else if (!decision.alternativesMd.trim()) problems.push('El ADR del stack debe describir las alternativas consideradas.');
  const foundation = features.find(feature => FOUNDATION.test(feature.title));
  if (!foundation) problems.push('Falta la feature «Fundación».');
  const scaffold = foundation ? tasks.find(task => task.parentId === foundation.tempId) : undefined;
  if (foundation && !scaffold) problems.push('La feature «Fundación» necesita una primera tarea de scaffold.');
  if (scaffold) {
    if (!scaffold.summary.includes(NO_INSTALL_RULE)) scaffold.summary = `${scaffold.summary.trim()}\n\n${NO_INSTALL_RULE}`.trim();
    if (!scaffold.acceptanceCriteria.includes(NO_INSTALL_CRITERION)) scaffold.acceptanceCriteria = [...scaffold.acceptanceCriteria, NO_INSTALL_CRITERION];
  }
  const relations = ops.filter((op): op is Op<'CREATE_RELATIONSHIP'> => op.type === 'CREATE_RELATIONSHIP');
  const depends = (source: string, target: string) => relations.some(edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === source && edge.targetId === target);
  const added: ChangeOperation[] = [];
  const addDependency = (source: string, target: string) => { if (source === target || depends(source, target)) return; const edge: Op<'CREATE_RELATIONSHIP'> = { type: 'CREATE_RELATIONSHIP', sourceId: source, targetId: target, edgeType: 'DEPENDS_ON' }; relations.push(edge); added.push(edge); };
  if (foundation) for (const feature of features) if (feature !== foundation && !relations.some(edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === feature.tempId && featureIds.has(edge.targetId))) addDependency(feature.tempId, foundation.tempId);
  const tasksOf = (featureId: string) => tasks.filter(task => task.parentId === featureId);
  const taskDeps = (task: Op<'CREATE_WORK_ITEM'>) => relations.filter(edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === task.tempId && byId.has(edge.targetId));
  // Last tasks of a feature: no other task of the same feature depends on them.
  const sinks = (featureId: string) => tasksOf(featureId).filter(task => !tasksOf(featureId).some(other => depends(other.tempId, task.tempId)));
  for (const feature of features) {
    const prerequisites = relations.filter(edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === feature.tempId && featureIds.has(edge.targetId)).map(edge => edge.targetId);
    for (const task of tasksOf(feature.tempId)) {
      if (task === scaffold || taskDeps(task).some(edge => tasksOf(feature.tempId).some(other => other.tempId === edge.targetId))) continue;
      if (feature === foundation && scaffold) addDependency(task.tempId, scaffold.tempId);
      for (const prerequisite of prerequisites) for (const sink of sinks(prerequisite)) addDependency(task.tempId, sink.tempId);
    }
  }
  if (options.uiSpec) {
    const spec = ops.find((op): op is Op<'UPSERT_ARTIFACT'> => op.type === 'UPSERT_ARTIFACT' && op.relativePath === UI_SPEC_PATH);
    if (!spec) problems.push(`Falta la especificación de interfaz (${UI_SPEC_PATH}) del diseño aprobado.`);
    else {
      const missing = UI_SPEC_SECTIONS.filter(section => !new RegExp(`^##\\s+${section}\\s*$`, 'mi').test(spec.markdownContent));
      if (missing.length) problems.push(`${UI_SPEC_PATH} no tiene las secciones: ${missing.join(', ')}.`);
      spec.tempId ||= '$ui_spec';
      for (const feature of features) if (!relations.some(edge => edge.edgeType === 'DOCUMENTED_BY' && edge.sourceId === feature.tempId && edge.targetId === spec.tempId)) added.push({ type: 'CREATE_RELATIONSHIP', sourceId: feature.tempId, targetId: spec.tempId, edgeType: 'DOCUMENTED_BY' });
    }
  }
  const statuses: ChangeOperation[] = tasks.map(task => ({ type: 'UPDATE_ENTITY_STATUS', entityId: task.tempId, newStatus: taskDeps(task).length ? 'BLOCKED' : 'READY', reason: 'Estado inicial del plan del inicio del proyecto.' }));
  const ready = tasks.filter(task => !taskDeps(task).length);
  if (scaffold && ready.some(task => task !== scaffold)) problems.push(`Solo la tarea de scaffold puede empezar lista; revisa las dependencias de ${ready.filter(task => task !== scaffold).map(task => `«${task.title}»`).join(', ')}.`);
  return { operations: [...ops, ...added, ...statuses], problems };
}

/** tempId of the scaffold task: the first task of «Fundación» (null when the plan has none). */
export function scaffoldTempId(operations: ChangeOperation[]): string | null {
  const foundation = operations.find((op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE' && FOUNDATION.test(op.title));
  return foundation ? operations.find((op): op is Op<'CREATE_WORK_ITEM'> => op.type === 'CREATE_WORK_ITEM' && op.parentId === foundation.tempId)?.tempId ?? null : null;
}

/** What the wizard shows of a proposal (no ids from the graph: the plan does not exist yet). */
export function summarizeFoundationPlan(operations: ChangeOperation[]): Pick<InceptionProposalDto, 'profile' | 'decision' | 'documents' | 'requirements' | 'features' | 'scaffoldTaskTitle'> {
  const profile = operations.find((op): op is Op<'SET_PROJECT_PROFILE'> => op.type === 'SET_PROJECT_PROFILE');
  const decision = operations.find((op): op is Op<'CREATE_DECISION_RECORD'> => op.type === 'CREATE_DECISION_RECORD');
  const tasks = operations.filter((op): op is Op<'CREATE_WORK_ITEM'> => op.type === 'CREATE_WORK_ITEM');
  const edges = operations.filter((op): op is Op<'CREATE_RELATIONSHIP'> => op.type === 'CREATE_RELATIONSHIP' && op.edgeType === 'DEPENDS_ON');
  const titles = new Map(operations.flatMap(op => 'tempId' in op && op.tempId && 'title' in op ? [[op.tempId, op.title] as const] : []));
  const status = new Map(operations.flatMap(op => op.type === 'UPDATE_ENTITY_STATUS' ? [[op.entityId, op.newStatus] as const] : []));
  const featureOps = operations.filter((op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE');
  const foundation = featureOps.find(feature => FOUNDATION.test(feature.title));
  const features: InceptionFeatureDto[] = featureOps.map(feature => ({
    tempId: feature.tempId, title: feature.title, isFoundation: feature === foundation,
    dependsOn: edges.filter(edge => edge.sourceId === feature.tempId).map(edge => titles.get(edge.targetId) ?? edge.targetId),
    tasks: tasks.filter(task => task.parentId === feature.tempId).map(task => ({ tempId: task.tempId, title: task.title, initialStatus: status.get(task.tempId) === 'READY' ? 'READY' as const : 'BLOCKED' as const })),
  }));
  return {
    profile: profile ? { description: profile.description ?? null, objectives: profile.objectives, outOfScope: profile.outOfScope, techStack: profile.techStack, rules: profile.rules, verificationCommands: profile.verificationCommands } : null,
    decision: decision ? { title: decision.title, alternativesMd: decision.alternativesMd, decisionMd: decision.decisionMd, consequencesMd: decision.consequencesMd } : null,
    documents: operations.flatMap(op => op.type === 'UPSERT_ARTIFACT' || op.type === 'CREATE_DECISION_RECORD' ? [{ title: op.title, relativePath: op.relativePath }] : []),
    requirements: operations.flatMap(op => op.type === 'CREATE_REQUIREMENT' ? [op.title] : []),
    features,
    scaffoldTaskTitle: foundation ? tasks.find(task => task.parentId === foundation.tempId)?.title ?? null : null,
  };
}
