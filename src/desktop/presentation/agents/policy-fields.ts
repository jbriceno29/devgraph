import type { ExecutionPolicyDto } from '../../../shared/contracts/agent-view.js';

/** The fields of the execution policy form and the defaults of the agent's decisions. */
export type Field = 'writablePaths' | 'readonlyPaths' | 'deniedPaths' | 'allowedCommands';
export const fields: Array<{ key: Field; label: string; hint: string }> = [
  { key: 'writablePaths', label: 'Rutas escribibles', hint: 'Una por línea, p. ej. src/**' },
  { key: 'readonlyPaths', label: 'Rutas de solo lectura', hint: 'El agente puede leerlas, no cambiarlas.' },
  { key: 'deniedPaths', label: 'Rutas prohibidas', hint: 'Ni lectura ni escritura, p. ej. .env*' },
  {
    key: 'allowedCommands',
    label: 'Comandos de verificación',
    hint: 'Uno por línea, sin tuberías, p. ej. npm test. Se ejecutan al validar.',
  },
];

export type DecisionPolicyDto = NonNullable<ExecutionPolicyDto['decisionPolicy']>;
type DecisionCategory = keyof DecisionPolicyDto['rules'];
// Mirrors DECISION_CATEGORIES / DEFAULT_DECISION_POLICY in src/domain/autonomy/decision-policy.ts (the UI does not import the domain).
export const decisionCategories: Array<{ category: DecisionCategory; label: string }> = [
  { category: 'NEW_TASK', label: 'Agregar tareas dentro de la misma feature' },
  { category: 'TASK_DEPENDENCY', label: 'Agregar dependencias entre tareas de la feature' },
  { category: 'TASK_STATUS', label: 'Cambiar el estado de tareas de la feature (por ejemplo, archivar una que sobra)' },
  { category: 'DECISION_RECORD', label: 'Registrar decisiones de arquitectura (ADR)' },
  {
    category: 'SCOPE_CHANGE',
    label: 'Cambiar el alcance: features, módulos, requisitos, documentos o entidades de otras features',
  },
];
export const defaultDecisionPolicy: DecisionPolicyDto = {
  rules: { NEW_TASK: 'AUTO', TASK_DEPENDENCY: 'AUTO', TASK_STATUS: 'ASK', DECISION_RECORD: 'ASK', SCOPE_CHANGE: 'ASK' },
  maxAutoTasksPerFeature: 5,
};

/** What the form shows for a policy, as one comparable string: anything else in the form is an unsaved draft. */
export function policySnapshot(policy: ExecutionPolicyDto, values: Record<Field, string>): string {
  const decisions = policy.decisionPolicy ?? defaultDecisionPolicy;
  return JSON.stringify({
    values,
    minutes: String(policy.maxExecutionMinutes ?? 30),
    turns: String(policy.maxTurns ?? 0),
    rules: { ...defaultDecisionPolicy.rules, ...decisions.rules },
    maxAutoTasks: String(decisions.maxAutoTasksPerFeature),
  });
}
