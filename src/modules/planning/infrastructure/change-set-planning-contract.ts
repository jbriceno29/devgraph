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
const slugPath = (title: string) =>
  title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'decision';
export function normalizeOperation(value: unknown, engine = 'Codex'): ChangeOperation {
  if (!value || typeof value !== 'object') throw new Error(`${engine} devolvió una operación inválida.`);
  const op = value as Record<string, unknown>,
    str = (key: string): string => {
      const item = op[key];
      if (typeof item !== 'string' || !item) throw new Error(`${engine} omitió el campo ${key} de una operación.`);
      return item;
    },
    text = (key: string): string => (typeof op[key] === 'string' ? (op[key] as string) : ''),
    nullable = (key: string): string | null | undefined =>
      op[key] === null || op[key] === undefined ? undefined : String(op[key]);
  switch (op.type) {
    case 'CREATE_MODULE': {
      const parentId = nullable('parentId'),
        moduleKind = nullable('moduleKind');
      return {
        type: 'CREATE_MODULE',
        tempId: str('tempId'),
        title: str('title'),
        summary: text('summary'),
        purpose: text('purpose') || text('summary') || str('title'),
        ...(parentId === undefined ? {} : { parentId }),
        ...(moduleKind ? { moduleKind: moduleKind as 'FUNCTIONAL' | 'TECHNICAL' | 'SHARED' } : {}),
      };
    }
    case 'CREATE_FEATURE': {
      const moduleId = nullable('moduleId') ?? nullable('parentId');
      if (!moduleId) throw new Error(`${engine} omitió moduleId de CREATE_FEATURE.`);
      return {
        type: 'CREATE_FEATURE',
        tempId: str('tempId'),
        moduleId,
        title: str('title'),
        summary: text('summary'),
        scope: text('scope'),
        priority: (nullable('priority') ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      };
    }
    case 'CREATE_REQUIREMENT': {
      const parentId = nullable('parentId');
      return {
        type: 'CREATE_REQUIREMENT',
        tempId: str('tempId'),
        title: str('title'),
        summary: text('summary'),
        reqType: (nullable('reqType') ?? 'FUNCTIONAL') as 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'CONSTRAINT',
        priority: (nullable('priority') ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        acceptanceCriteria: Array.isArray(op.acceptanceCriteria) ? op.acceptanceCriteria.map(String) : [],
        ...(parentId === undefined ? {} : { parentId }),
      };
    }
    case 'CREATE_WORK_ITEM':
      return {
        type: 'CREATE_WORK_ITEM',
        tempId: str('tempId'),
        parentId: str('parentId'),
        workType: (nullable('workType') ?? 'TASK') as 'TASK' | 'BUG' | 'SPIKE' | 'IMPROVEMENT',
        title: str('title'),
        summary: text('summary'),
        acceptanceCriteria: Array.isArray(op.acceptanceCriteria) ? op.acceptanceCriteria.map(String) : [],
        ...(nullable('priority') ? { priority: nullable('priority') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' } : {}),
        ...(nullable('recommendedProfileRole')
          ? {
              recommendedProfileRole: nullable('recommendedProfileRole') as
                | 'PLANNER'
                | 'ARCHITECT'
                | 'DEVELOPER'
                | 'REVIEWER'
                | 'KNOWLEDGE_MANAGER',
            }
          : {}),
      };
    // A document the engine left untitled takes its file name (a real run with haiku omitted it when rewriting docs/UI_SPEC.md).
    case 'UPSERT_ARTIFACT': {
      const tempId = nullable('tempId'),
        entityId = nullable('entityId'),
        parentId = nullable('parentId');
      return {
        type: 'UPSERT_ARTIFACT',
        title: text('title').trim() || str('relativePath').split('/').pop()!.replace(/\.md$/i, ''),
        artifactType: str('artifactType') as
          | 'PRD'
          | 'ARCHITECTURE'
          | 'SPEC'
          | 'IMPLEMENTATION_PLAN'
          | 'DOMAIN_DOC'
          | 'OTHER',
        relativePath: str('relativePath'),
        markdownContent: str('markdownContent'),
        ...(tempId ? { tempId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(parentId === undefined ? {} : { parentId }),
      };
    }
    // An ADR the engine left without a path gets one from its title under docs/architecture/ADR/ (a real run with haiku omitted it).
    case 'CREATE_DECISION_RECORD':
      return {
        type: 'CREATE_DECISION_RECORD',
        tempId: str('tempId'),
        title: str('title'),
        contextMd: str('contextMd'),
        alternativesMd: str('alternativesMd'),
        decisionMd: str('decisionMd'),
        consequencesMd: str('consequencesMd'),
        relativePath: text('relativePath').trim() || `docs/architecture/ADR/${slugPath(str('title'))}.md`,
      };
    case 'CREATE_RELATIONSHIP':
      return {
        type: 'CREATE_RELATIONSHIP',
        sourceId: str('sourceId'),
        targetId: str('targetId'),
        edgeType: str('edgeType') as import('../../../shared/contracts/graph-view.js').GraphEdgeType,
      };
    case 'UPDATE_ENTITY_STATUS':
      return {
        type: 'UPDATE_ENTITY_STATUS',
        entityId: str('entityId'),
        newStatus: str('newStatus'),
        reason: str('reason'),
      };
    case 'DELETE_RELATIONSHIP':
      return { type: 'DELETE_RELATIONSHIP', edgeId: str('edgeId'), reason: str('reason') };
    case 'SET_PROJECT_PROFILE': {
      const list = (key: string): string[] =>
        Array.isArray(op[key])
          ? (op[key] as unknown[])
              .map(String)
              .map(item => item.trim())
              .filter(Boolean)
          : [];
      const raw = Array.isArray(op.techStack)
        ? Object.fromEntries(
            (op.techStack as unknown[]).flatMap(item =>
              item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string'
                ? [[(item as { key: string }).key.trim(), (item as { value?: unknown }).value]]
                : [],
            ),
          )
        : op.techStack;
      const stack =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? Object.fromEntries(
              Object.entries(raw as Record<string, unknown>)
                .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
                .map(([key, value]) => [key, String(value).trim()]),
            )
          : {};
      const description = nullable('description'),
        stackProfileId = nullable('stackProfileId');
      return {
        type: 'SET_PROJECT_PROFILE',
        objectives: list('objectives'),
        outOfScope: list('outOfScope'),
        techStack: stack,
        rules: list('rules'),
        verificationCommands: list('verificationCommands'),
        ...(description ? { description } : {}),
        ...(stackProfileId ? { stackProfileId } : {}),
      };
    }
    default:
      throw new Error(`${engine} devolvió un tipo de operación desconocido: ${String(op.type)}.`);
  }
}
