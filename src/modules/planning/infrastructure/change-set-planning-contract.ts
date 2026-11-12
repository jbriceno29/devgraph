import type { ChangeOperation } from '../../knowledge/index.js';
import type { ChangeSetPlannerPort } from '../application/ports/change-set-planning-port.js';
export {
  GRAPH_RULES,
  buildPlannerPrompt,
  MAX_UI_SPEC_CHARS,
  planningReferencesBlock,
  uiSpecPlanningBlock,
} from './prompts/planner-prompt.js';

export * from './planner-schema.js';
export { normalizeOperation } from './normalize-operation.js';
import { normalizeOperation } from './normalize-operation.js';

/**
 * Engine-independent parts of ChangeSet planning: the operation schema, the planner prompt and the
 * normalization of the engine's JSON into domain operations.
 */
export type PlannerInput = Parameters<ChangeSetPlannerPort['propose']>[0];

/** Parses the engine's JSON draft; `engine` names the CLI in error messages. */
export function parsePlannerDraft(
  parsed: unknown,
  engine: string,
): { title: string; rationale: string; operations: ChangeOperation[] } {
  const draft = parsed as { title?: unknown; rationale?: unknown; operations?: unknown } | null;
  if (
    !draft ||
    typeof draft.title !== 'string' ||
    typeof draft.rationale !== 'string' ||
    !Array.isArray(draft.operations)
  )
    throw new Error(`${engine} devolvió una propuesta incompleta.`);
  return {
    title: draft.title,
    rationale: draft.rationale,
    operations: draft.operations.map(operation => normalizeOperation(operation, engine)),
  };
}

/** A file name from a title: lowercase ASCII letters, digits and dashes (accents removed), at most 60 characters. */
