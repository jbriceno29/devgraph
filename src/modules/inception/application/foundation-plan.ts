import type { ChangeOperation } from '../../knowledge/index.js';
import { UI_SPEC_PATH, UI_SPEC_SECTIONS } from '../../../shared/ui-spec.js';
import type {
  InceptionFeatureDto,
  InceptionProposalDto,
  InceptionStackProfileDto,
} from '../../../shared/contracts/inception-view.js';
import { STACK_PROFILES, applyStackProfile, findStackProfile, profilePackages } from '../../projects/index.js';
export { summarizeFoundationPlan } from './foundation-summary.js';

export type Op<T extends ChangeOperation['type']> = Extract<ChangeOperation, { type: T }>;
export const FOUNDATION = /fundaci[oó]n|foundation/i;
/** Decision 5: the scaffold never installs dependencies nor runs package scripts; the user installs. */
export const NO_INSTALL_RULE =
  'No instales dependencias ni ejecutes scripts de paquetes ni generadores (npm install, npx, pip install, create-*, etc.): crea los archivos a mano. Si el stack necesita dependencias externas, déjalas anotadas en el README para que las instale el usuario.';
const NO_INSTALL_CRITERION = 'No se instaló ninguna dependencia ni se ejecutaron scripts de paquetes o generadores.';
const KEPT: ReadonlySet<ChangeOperation['type']> = new Set([
  'SET_PROJECT_PROFILE',
  'CREATE_MODULE',
  'CREATE_FEATURE',
  'CREATE_REQUIREMENT',
  'CREATE_WORK_ITEM',
  'CREATE_DECISION_RECORD',
  'UPSERT_ARTIFACT',
  'CREATE_RELATIONSHIP',
]);

/**
 * Turns the engine's draft into the inception proposal, deterministically: only creations on a greenfield graph,
 * modules under the root, flat tasks, the no-install rule in the scaffold task, «Fundación» as prerequisite of every
 * other feature, feature dependencies mirrored on tasks (so no task starts before its prerequisites), and the initial
 * statuses (the scaffold READY, the rest BLOCKED). `problems` lists what the draft lacks; the user revises it then.
 */
export function buildFoundationPlan(
  operations: ChangeOperation[],
  rootId: string,
  options: { uiSpec?: boolean; brownfield?: boolean } = {},
): { operations: ChangeOperation[]; problems: string[] } {
  const plan = preparePlan(operations, rootId);
  const stackProfile = applyProfile(plan, options.brownfield === true);
  const decision = plan.ops.find((op): op is Op<'CREATE_DECISION_RECORD'> => op.type === 'CREATE_DECISION_RECORD');
  if (!decision) plan.problems.push('Falta el ADR del stack con sus alternativas.');
  else if (!decision.alternativesMd.trim())
    plan.problems.push('El ADR del stack debe describir las alternativas consideradas.');
  const foundation = plan.features.find(feature => FOUNDATION.test(feature.title));
  if (!foundation) plan.problems.push('Falta la feature «Fundación».');
  const scaffold = foundation ? plan.tasks.find(task => task.parentId === foundation.tempId) : undefined;
  if (foundation && !scaffold) plan.problems.push('La feature «Fundación» necesita una primera tarea de scaffold.');
  if (scaffold) guideScaffold(scaffold, stackProfile);
  if (foundation) dependOnFoundation(plan, foundation);
  wireTasks(plan, foundation, scaffold);
  if (options.uiSpec) linkUiSpec(plan);
  const statuses = initialStatuses(plan, scaffold);
  return { operations: [...plan.ops, ...plan.added, ...statuses], problems: plan.problems };
}

/** The draft being turned into the proposal: its operations, features, tasks and dependency edges (new ones in `added`). */
interface Plan {
  ops: ChangeOperation[];
  features: Op<'CREATE_FEATURE'>[];
  tasks: Op<'CREATE_WORK_ITEM'>[];
  featureIds: Set<string>;
  byId: Map<string, Op<'CREATE_WORK_ITEM'>>;
  relations: Op<'CREATE_RELATIONSHIP'>[];
  added: ChangeOperation[];
  problems: string[];
}

/** Only creations on a greenfield graph, modules under the root, and flat tasks (a subtask moves under its parent's feature). */
function preparePlan(operations: ChangeOperation[], rootId: string): Plan {
  const ops = operations
    .filter(op => KEPT.has(op.type) && !(op.type === 'UPSERT_ARTIFACT' && op.entityId && !op.tempId))
    .map(op => ({ ...op })) as ChangeOperation[];
  for (const op of ops) if (op.type === 'CREATE_MODULE' && !op.parentId) op.parentId = rootId;
  const features = ops.filter((op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE');
  const tasks = ops.filter((op): op is Op<'CREATE_WORK_ITEM'> => op.type === 'CREATE_WORK_ITEM');
  const byId = new Map(tasks.map(task => [task.tempId, task]));
  for (const task of tasks) {
    let parent = task.parentId,
      depth = 0;
    while (byId.has(parent) && depth++ < 8) parent = byId.get(parent)!.parentId;
    task.parentId = parent;
  }
  return {
    ops,
    features,
    tasks,
    featureIds: new Set(features.map(feature => feature.tempId)),
    byId,
    relations: ops.filter((op): op is Op<'CREATE_RELATIONSHIP'> => op.type === 'CREATE_RELATIONSHIP'),
    added: [],
    problems: [],
  };
}

/** Plan S1: a new project follows a stack profile of the catalog, which sets its stack, rules and verification; an existing one keeps its stack. */
function applyProfile(plan: Plan, brownfield: boolean) {
  const { ops, problems } = plan;
  if (ops.filter(op => op.type === 'SET_PROJECT_PROFILE').length !== 1)
    problems.push(
      'La propuesta debe fijar el perfil del proyecto (objetivo, alcance, stack, reglas y verificación) exactamente una vez.',
    );
  const profileIndex = ops.findIndex(op => op.type === 'SET_PROJECT_PROFILE');
  const proposedProfile = profileIndex >= 0 ? (ops[profileIndex] as Op<'SET_PROJECT_PROFILE'>) : undefined;
  const stackProfile = brownfield ? null : findStackProfile(proposedProfile?.stackProfileId);
  if (proposedProfile && brownfield) delete proposedProfile.stackProfileId;
  else if (proposedProfile && stackProfile)
    ops[profileIndex] = { ...applyStackProfile(proposedProfile, stackProfile), type: 'SET_PROJECT_PROFILE' };
  else if (proposedProfile)
    problems.push(
      `${proposedProfile.stackProfileId ? `El perfil de stack «${proposedProfile.stackProfileId}» no existe` : 'Falta el perfil de stack'}: elige uno del catálogo (${STACK_PROFILES.map(profile => profile.id).join(', ')}).`,
    );
  return stackProfile;
}

/** The scaffold task carries the profile's structure and the no-install rule (decision 5). */
function guideScaffold(scaffold: Op<'CREATE_WORK_ITEM'>, stackProfile: ReturnType<typeof findStackProfile>): void {
  if (stackProfile) {
    const guide = `Perfil de stack «${stackProfile.title}» (${stackProfile.id}). Estructura: ${stackProfile.structure} ${stackProfile.scaffold}`;
    if (!scaffold.summary.includes(guide)) scaffold.summary = `${scaffold.summary.trim()}\n\n${guide}`.trim();
  }
  if (!scaffold.summary.includes(NO_INSTALL_RULE))
    scaffold.summary = `${scaffold.summary.trim()}\n\n${NO_INSTALL_RULE}`.trim();
  if (!scaffold.acceptanceCriteria.includes(NO_INSTALL_CRITERION))
    scaffold.acceptanceCriteria = [...scaffold.acceptanceCriteria, NO_INSTALL_CRITERION];
}

const depends = (plan: Plan, source: string, target: string) =>
  plan.relations.some(edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === source && edge.targetId === target);

function addDependency(plan: Plan, source: string, target: string): void {
  if (source === target || depends(plan, source, target)) return;
  const edge: Op<'CREATE_RELATIONSHIP'> = {
    type: 'CREATE_RELATIONSHIP',
    sourceId: source,
    targetId: target,
    edgeType: 'DEPENDS_ON',
  };
  plan.relations.push(edge);
  plan.added.push(edge);
}

const featurePrerequisites = (plan: Plan, featureId: string) =>
  plan.relations
    .filter(edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === featureId && plan.featureIds.has(edge.targetId))
    .map(edge => edge.targetId);

/** «Fundación» is a prerequisite of every feature that depends on no other feature. */
function dependOnFoundation(plan: Plan, foundation: Op<'CREATE_FEATURE'>): void {
  for (const feature of plan.features)
    if (feature !== foundation && !featurePrerequisites(plan, feature.tempId).length)
      addDependency(plan, feature.tempId, foundation.tempId);
}

const taskDeps = (plan: Plan, task: Op<'CREATE_WORK_ITEM'>) =>
  plan.relations.filter(
    edge => edge.edgeType === 'DEPENDS_ON' && edge.sourceId === task.tempId && plan.byId.has(edge.targetId),
  );

/**
 * Feature dependencies mirrored on tasks, so no task starts before its prerequisites: the first tasks of a feature
 * depend on the last tasks of each prerequisite feature (and, in «Fundación», on the scaffold).
 */
function wireTasks(
  plan: Plan,
  foundation: Op<'CREATE_FEATURE'> | undefined,
  scaffold: Op<'CREATE_WORK_ITEM'> | undefined,
) {
  const tasksOf = (featureId: string) => plan.tasks.filter(task => task.parentId === featureId);
  // Last tasks of a feature: no other task of the same feature depends on them.
  const sinks = (featureId: string) =>
    tasksOf(featureId).filter(task => !tasksOf(featureId).some(other => depends(plan, other.tempId, task.tempId)));
  for (const feature of plan.features) {
    const prerequisites = featurePrerequisites(plan, feature.tempId);
    for (const task of tasksOf(feature.tempId)) {
      if (
        task === scaffold ||
        taskDeps(plan, task).some(edge => tasksOf(feature.tempId).some(other => other.tempId === edge.targetId))
      )
        continue;
      if (feature === foundation && scaffold) addDependency(plan, task.tempId, scaffold.tempId);
      for (const prerequisite of prerequisites)
        for (const sink of sinks(prerequisite)) addDependency(plan, task.tempId, sink.tempId);
    }
  }
}

/** The approved design's specification must keep its sections, and every feature is DOCUMENTED_BY it. */
function linkUiSpec(plan: Plan): void {
  const spec = plan.ops.find(
    (op): op is Op<'UPSERT_ARTIFACT'> => op.type === 'UPSERT_ARTIFACT' && op.relativePath === UI_SPEC_PATH,
  );
  if (!spec) {
    plan.problems.push(`Falta la especificación de interfaz (${UI_SPEC_PATH}) del diseño aprobado.`);
    return;
  }
  const missing = UI_SPEC_SECTIONS.filter(
    section => !new RegExp(`^##\\s+${section}\\s*$`, 'mi').test(spec.markdownContent),
  );
  if (missing.length) plan.problems.push(`${UI_SPEC_PATH} no tiene las secciones: ${missing.join(', ')}.`);
  spec.tempId ||= '$ui_spec';
  for (const feature of plan.features)
    if (
      !plan.relations.some(
        edge => edge.edgeType === 'DOCUMENTED_BY' && edge.sourceId === feature.tempId && edge.targetId === spec.tempId,
      )
    )
      plan.added.push({
        type: 'CREATE_RELATIONSHIP',
        sourceId: feature.tempId,
        targetId: spec.tempId,
        edgeType: 'DOCUMENTED_BY',
      });
}

/** The scaffold starts READY, the rest BLOCKED; the ADRs start accepted (approving the foundation is the user's decision). */
function initialStatuses(plan: Plan, scaffold: Op<'CREATE_WORK_ITEM'> | undefined): ChangeOperation[] {
  const statuses: ChangeOperation[] = plan.tasks.map(task => ({
    type: 'UPDATE_ENTITY_STATUS',
    entityId: task.tempId,
    newStatus: taskDeps(plan, task).length ? 'BLOCKED' : 'READY',
    reason: 'Estado inicial del plan del inicio del proyecto.',
  }));
  // Approving the foundation is the user's decision: its ADRs start accepted, so they reach the agents' context.
  for (const decision of plan.ops)
    if (decision.type === 'CREATE_DECISION_RECORD' && decision.tempId)
      statuses.push({
        type: 'UPDATE_ENTITY_STATUS',
        entityId: decision.tempId,
        newStatus: 'ACCEPTED',
        reason: 'Aceptada al aprobar el plan del inicio del proyecto.',
      });
  const ready = plan.tasks.filter(task => !taskDeps(plan, task).length);
  if (scaffold && ready.some(task => task !== scaffold))
    plan.problems.push(
      `Solo la tarea de scaffold puede empezar lista; revisa las dependencias de ${ready
        .filter(task => task !== scaffold)
        .map(task => `«${task.title}»`)
        .join(', ')}.`,
    );
  return statuses;
}

/** tempId of the scaffold task: the first task of «Fundación» (null when the plan has none). */
export function scaffoldTempId(operations: ChangeOperation[]): string | null {
  const foundation = operations.find(
    (op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE' && FOUNDATION.test(op.title),
  );
  return foundation
    ? (operations.find(
        (op): op is Op<'CREATE_WORK_ITEM'> => op.type === 'CREATE_WORK_ITEM' && op.parentId === foundation.tempId,
      )?.tempId ?? null)
    : null;
}
