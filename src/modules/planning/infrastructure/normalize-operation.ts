import type { ChangeOperation } from '../../knowledge/index.js';
import type { GraphEdgeType } from '../../../shared/contracts/graph-view.js';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Role = 'PLANNER' | 'ARCHITECT' | 'DEVELOPER' | 'REVIEWER' | 'KNOWLEDGE_MANAGER';
type ArtifactType = 'PRD' | 'ARCHITECTURE' | 'SPEC' | 'IMPLEMENTATION_PLAN' | 'DOMAIN_DOC' | 'OTHER';

/** Reads the fields of one raw operation: `str` is required, `text` defaults to '', `nullable` is undefined when absent. */
interface Reader {
  op: Record<string, unknown>;
  str(key: string): string;
  text(key: string): string;
  nullable(key: string): string | null | undefined;
  engine: string;
}

const slugPath = (title: string) =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'decision';
const criteria = (op: Record<string, unknown>) =>
  Array.isArray(op.acceptanceCriteria) ? op.acceptanceCriteria.map(String) : [];

/** The engine's JSON for one operation as a domain operation; missing required fields fail with the engine's name. */
export function normalizeOperation(value: unknown, engine = 'Codex'): ChangeOperation {
  if (!value || typeof value !== 'object') throw new Error(`${engine} devolvió una operación inválida.`);
  const op = value as Record<string, unknown>;
  const reader: Reader = {
    op,
    engine,
    str: key => {
      const item = op[key];
      if (typeof item !== 'string' || !item) throw new Error(`${engine} omitió el campo ${key} de una operación.`);
      return item;
    },
    text: key => (typeof op[key] === 'string' ? (op[key] as string) : ''),
    nullable: key => (op[key] === null || op[key] === undefined ? undefined : String(op[key])),
  };
  const normalize = NORMALIZERS[String(op.type)];
  if (!normalize) throw new Error(`${engine} devolvió un tipo de operación desconocido: ${String(op.type)}.`);
  return normalize(reader);
}

const NORMALIZERS: Record<string, (r: Reader) => ChangeOperation> = {
  CREATE_MODULE: ({ str, text, nullable }) => {
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
  },
  CREATE_FEATURE: ({ str, text, nullable, engine }) => {
    const moduleId = nullable('moduleId') ?? nullable('parentId');
    if (!moduleId) throw new Error(`${engine} omitió moduleId de CREATE_FEATURE.`);
    return {
      type: 'CREATE_FEATURE',
      tempId: str('tempId'),
      moduleId,
      title: str('title'),
      summary: text('summary'),
      scope: text('scope'),
      priority: (nullable('priority') ?? 'MEDIUM') as Priority,
    };
  },
  CREATE_REQUIREMENT: ({ op, str, text, nullable }) => {
    const parentId = nullable('parentId');
    return {
      type: 'CREATE_REQUIREMENT',
      tempId: str('tempId'),
      title: str('title'),
      summary: text('summary'),
      reqType: (nullable('reqType') ?? 'FUNCTIONAL') as 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'CONSTRAINT',
      priority: (nullable('priority') ?? 'MEDIUM') as Priority,
      acceptanceCriteria: criteria(op),
      ...(parentId === undefined ? {} : { parentId }),
    };
  },
  CREATE_WORK_ITEM: ({ op, str, text, nullable }) => ({
    type: 'CREATE_WORK_ITEM',
    tempId: str('tempId'),
    parentId: str('parentId'),
    workType: (nullable('workType') ?? 'TASK') as 'TASK' | 'BUG' | 'SPIKE' | 'IMPROVEMENT',
    title: str('title'),
    summary: text('summary'),
    acceptanceCriteria: criteria(op),
    ...(nullable('priority') ? { priority: nullable('priority') as Priority } : {}),
    ...(nullable('recommendedProfileRole')
      ? { recommendedProfileRole: nullable('recommendedProfileRole') as Role }
      : {}),
  }),
  // A document the engine left untitled takes its file name (a real run with haiku omitted it when rewriting docs/UI_SPEC.md).
  UPSERT_ARTIFACT: ({ str, text, nullable }) => {
    const tempId = nullable('tempId'),
      entityId = nullable('entityId'),
      parentId = nullable('parentId');
    return {
      type: 'UPSERT_ARTIFACT',
      title: text('title').trim() || str('relativePath').split('/').pop()!.replace(/\.md$/i, ''),
      artifactType: str('artifactType') as ArtifactType,
      relativePath: str('relativePath'),
      markdownContent: str('markdownContent'),
      ...(tempId ? { tempId } : {}),
      ...(entityId ? { entityId } : {}),
      ...(parentId === undefined ? {} : { parentId }),
    };
  },
  // An ADR the engine left without a path gets one from its title under docs/architecture/ADR/ (a real run with haiku omitted it).
  CREATE_DECISION_RECORD: ({ str, text }) => ({
    type: 'CREATE_DECISION_RECORD',
    tempId: str('tempId'),
    title: str('title'),
    contextMd: str('contextMd'),
    alternativesMd: str('alternativesMd'),
    decisionMd: str('decisionMd'),
    consequencesMd: str('consequencesMd'),
    relativePath: text('relativePath').trim() || `docs/architecture/ADR/${slugPath(str('title'))}.md`,
  }),
  CREATE_RELATIONSHIP: ({ str }) => ({
    type: 'CREATE_RELATIONSHIP',
    sourceId: str('sourceId'),
    targetId: str('targetId'),
    edgeType: str('edgeType') as GraphEdgeType,
  }),
  UPDATE_ENTITY_STATUS: ({ str }) => ({
    type: 'UPDATE_ENTITY_STATUS',
    entityId: str('entityId'),
    newStatus: str('newStatus'),
    reason: str('reason'),
  }),
  DELETE_RELATIONSHIP: ({ str }) => ({ type: 'DELETE_RELATIONSHIP', edgeId: str('edgeId'), reason: str('reason') }),
  SET_PROJECT_PROFILE: ({ op, nullable }) => {
    const list = (key: string): string[] =>
      Array.isArray(op[key])
        ? (op[key] as unknown[])
            .map(String)
            .map(item => item.trim())
            .filter(Boolean)
        : [];
    const description = nullable('description'),
      stackProfileId = nullable('stackProfileId');
    return {
      type: 'SET_PROJECT_PROFILE',
      objectives: list('objectives'),
      outOfScope: list('outOfScope'),
      techStack: techStackOf(op.techStack),
      rules: list('rules'),
      verificationCommands: list('verificationCommands'),
      ...(description ? { description } : {}),
      ...(stackProfileId ? { stackProfileId } : {}),
    };
  },
};

/** techStack as a record; structured output sends it as key/value pairs, which become the record. */
function techStackOf(value: unknown): Record<string, string> {
  const raw = Array.isArray(value)
    ? Object.fromEntries(
        (value as unknown[]).flatMap(item =>
          item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string'
            ? [[(item as { key: string }).key.trim(), (item as { value?: unknown }).value]]
            : [],
        ),
      )
    : value;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(
        Object.entries(raw as Record<string, unknown>)
          .filter(([, item]) => item !== null && item !== undefined && String(item).trim())
          .map(([key, item]) => [key, String(item).trim()]),
      )
    : {};
}
