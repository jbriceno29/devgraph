import { edgeLabel, operationLabel } from '../labels.js';

/** What an operation of a proposal does, as the planner lists it. */
export const describeOperation = (operation: Record<string, unknown>) =>
  operation.type === 'CREATE_RELATIONSHIP' && typeof operation.edgeType === 'string'
    ? `Relacionar · ${edgeLabel(operation.edgeType)}`
    : operationLabel(String(operation.type ?? 'CAMBIO'));

const strings = (value: unknown) => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);

/**
 * The detail next to an operation: its title, or for a project profile (plan C7a) the stack and the checks it sets, so
 * approving a stack change says which stack the project moves to.
 */
export function operationDetail(operation: Record<string, unknown>): string | null {
  if (typeof operation.title === 'string') return operation.title;
  if (operation.type !== 'SET_PROJECT_PROFILE') return null;
  const stack = operation.techStack && typeof operation.techStack === 'object' ? operation.techStack : {};
  const values = Object.values(stack as Record<string, unknown>).filter(value => typeof value === 'string');
  const checks = strings(operation.verificationCommands);
  const parts = [
    values.length ? `Stack: ${values.join(', ')}` : '',
    checks.length ? `Comprobaciones: ${checks.join(', ')}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
