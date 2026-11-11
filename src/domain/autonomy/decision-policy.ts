/**
 * Which plan changes an agent may make on its own (Stage 3, decisions). The agent proposes graph changes when it
 * closes a task; the project's policy classifies each operation and decides whether the whole proposal is applied
 * automatically or waits for the user. The project — not the engine — defines what counts as an important decision.
 */
export type DecisionCategory = 'NEW_TASK' | 'TASK_DEPENDENCY' | 'TASK_STATUS' | 'DECISION_RECORD' | 'SCOPE_CHANGE';
export type DecisionMode = 'AUTO' | 'ASK';
export interface DecisionPolicy {
  rules: Record<DecisionCategory, DecisionMode>;
  /** New tasks the agents may add to one feature without asking; beyond that every new task asks. */
  maxAutoTasksPerFeature: number;
}
export const DECISION_CATEGORIES: ReadonlyArray<{ category: DecisionCategory; label: string }> = [
  { category: 'NEW_TASK', label: 'Agregar tareas dentro de la misma feature' },
  { category: 'TASK_DEPENDENCY', label: 'Agregar dependencias entre tareas de la feature' },
  { category: 'TASK_STATUS', label: 'Cambiar el estado de tareas de la feature (por ejemplo, archivar una que sobra)' },
  { category: 'DECISION_RECORD', label: 'Registrar decisiones de arquitectura (ADR)' },
  { category: 'SCOPE_CHANGE', label: 'Cambiar el alcance: features, módulos, requisitos, documentos o entidades de otras features' },
];
export const DEFAULT_DECISION_POLICY: DecisionPolicy = {
  rules: { NEW_TASK: 'AUTO', TASK_DEPENDENCY: 'AUTO', TASK_STATUS: 'ASK', DECISION_RECORD: 'ASK', SCOPE_CHANGE: 'ASK' },
  maxAutoTasksPerFeature: 5,
};

/** Accepts a partial or stored policy and returns a complete, valid one; throws on invalid values. */
export function normalizeDecisionPolicy(value: unknown): DecisionPolicy {
  if (value === null || value === undefined) return structuredClone(DEFAULT_DECISION_POLICY);
  const input = value as { rules?: Record<string, unknown>; maxAutoTasksPerFeature?: unknown };
  const rules = { ...DEFAULT_DECISION_POLICY.rules };
  for (const [key, mode] of Object.entries(input.rules ?? {})) {
    if (!(key in rules)) throw new Error(`Categoría de decisión desconocida: ${key}`);
    if (mode !== 'AUTO' && mode !== 'ASK') throw new Error(`Modo de decisión inválido para ${key}: ${String(mode)}`);
    rules[key as DecisionCategory] = mode;
  }
  const max = input.maxAutoTasksPerFeature ?? DEFAULT_DECISION_POLICY.maxAutoTasksPerFeature;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 0 || max > 50) throw new Error('El máximo de tareas automáticas por feature debe estar entre 0 y 50.');
  return { rules, maxAutoTasksPerFeature: max };
}

/** What the classifier needs to know about the graph around the task that proposes. */
export interface DecisionScope {
  /** Existing work items of the feature (ids). */
  featureTasks: ReadonlySet<string>;
  featureId: string;
  /** New tasks the agents already added to this feature automatically. */
  autoTasksSoFar: number;
}
type Operation = { type: string; [key: string]: unknown };

export function classifyOperation(operation: Operation, scope: DecisionScope, newTasks: ReadonlySet<string>, newDecisions: ReadonlySet<string>): DecisionCategory {
  const inFeature = (id: unknown) => typeof id === 'string' && (scope.featureTasks.has(id) || newTasks.has(id));
  switch (operation.type) {
    case 'CREATE_WORK_ITEM': return operation.parentId === scope.featureId || inFeature(operation.parentId) ? 'NEW_TASK' : 'SCOPE_CHANGE';
    case 'CREATE_RELATIONSHIP':
      if (operation.edgeType === 'DEPENDS_ON' && inFeature(operation.sourceId) && inFeature(operation.targetId)) return 'TASK_DEPENDENCY';
      if (operation.edgeType === 'AFFECTS' && typeof operation.sourceId === 'string' && newDecisions.has(operation.sourceId)) return 'DECISION_RECORD';
      return 'SCOPE_CHANGE';
    case 'UPDATE_ENTITY_STATUS': return inFeature(operation.entityId) ? 'TASK_STATUS' : 'SCOPE_CHANGE';
    case 'CREATE_DECISION_RECORD': return 'DECISION_RECORD';
    default: return 'SCOPE_CHANGE';
  }
}

export interface DecisionVerdict { mode: DecisionMode; categories: DecisionCategory[]; reasons: string[] }

/** A proposal is applied on its own only when every operation is AUTO under the policy. */
export function decide(operations: Operation[], policy: DecisionPolicy, scope: DecisionScope): DecisionVerdict {
  const newTasks = new Set(operations.filter(op => op.type === 'CREATE_WORK_ITEM' && typeof op.tempId === 'string').map(op => op.tempId as string));
  const newDecisions = new Set(operations.filter(op => op.type === 'CREATE_DECISION_RECORD' && typeof op.tempId === 'string').map(op => op.tempId as string));
  const categories = operations.map(op => classifyOperation(op, scope, newTasks, newDecisions));
  const reasons: string[] = [];
  for (const category of new Set(categories)) if (policy.rules[category] === 'ASK') reasons.push(`${DECISION_CATEGORIES.find(item => item.category === category)!.label}: la política pide revisión.`);
  const added = categories.filter(category => category === 'NEW_TASK').length;
  if (added && scope.autoTasksSoFar + added > policy.maxAutoTasksPerFeature) reasons.push(`Se agregarían ${scope.autoTasksSoFar + added} tareas automáticas a la feature y el máximo es ${policy.maxAutoTasksPerFeature}.`);
  return { mode: reasons.length ? 'ASK' : 'AUTO', categories, reasons };
}

const BLOCK = /```propuestas[^\n]*\n([\s\S]*?)```/i;
/** The agent's plan proposal: a ```propuestas fenced JSON block at the end of its closing summary. */
export function extractProposalBlock(summary: string): { raw: unknown } | { error: string } | null {
  const match = BLOCK.exec(summary);
  if (!match) return null;
  try { return { raw: JSON.parse(match[1]!.trim()) }; } catch (error) { return { error: `El bloque de propuestas no es JSON válido: ${error instanceof Error ? error.message : String(error)}` }; }
}
/** The summary without the proposal block, which is not project memory (the applied changes are, in the graph). */
export function stripProposalBlock(summary: string): string { return summary.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trim(); }
