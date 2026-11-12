import type { GraphEdgeType } from '../../../shared/contracts/graph-view.js';
import { STACK_PROFILES } from '../../projects/index.js';

/** Edge types a planned ChangeSet may create (execution-only edges like MODIFIES or GENERATED_BY are excluded). */
export const PLANNER_EDGE_TYPES: readonly GraphEdgeType[] = [
  'DEPENDS_ON',
  'IMPLEMENTS',
  'SATISFIES',
  'AFFECTS',
  'SUPERSEDES',
  'DOCUMENTED_BY',
];

/** JSON schema of the planner's output: every operation type a planned ChangeSet may contain and their fields. */
const nullableString = { type: ['string', 'null'] };
export const operationProperties: Record<string, Record<string, unknown>> = {
  type: {
    type: 'string',
    enum: [
      'CREATE_MODULE',
      'CREATE_FEATURE',
      'CREATE_REQUIREMENT',
      'CREATE_WORK_ITEM',
      'CREATE_DECISION_RECORD',
      'UPSERT_ARTIFACT',
      'UPDATE_ENTITY_STATUS',
      'CREATE_RELATIONSHIP',
      'DELETE_RELATIONSHIP',
      'SET_PROJECT_PROFILE',
    ],
  },
  tempId: nullableString,
  parentId: nullableString,
  moduleId: nullableString,
  entityId: nullableString,
  edgeId: nullableString,
  sourceId: nullableString,
  targetId: nullableString,
  title: nullableString,
  summary: nullableString,
  purpose: nullableString,
  scope: nullableString,
  priority: { type: ['string', 'null'], enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', null] },
  moduleKind: { type: ['string', 'null'], enum: ['FUNCTIONAL', 'TECHNICAL', 'SHARED', null] },
  reqType: { type: ['string', 'null'], enum: ['FUNCTIONAL', 'NON_FUNCTIONAL', 'CONSTRAINT', null] },
  workType: { type: ['string', 'null'], enum: ['TASK', 'BUG', 'SPIKE', 'IMPROVEMENT', null] },
  recommendedProfileRole: {
    type: ['string', 'null'],
    enum: ['PLANNER', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'KNOWLEDGE_MANAGER', null],
  },
  artifactType: {
    type: ['string', 'null'],
    enum: ['PRD', 'ARCHITECTURE', 'SPEC', 'IMPLEMENTATION_PLAN', 'DOMAIN_DOC', 'OTHER', null],
  },
  acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  relativePath: nullableString,
  markdownContent: nullableString,
  contextMd: nullableString,
  alternativesMd: nullableString,
  decisionMd: nullableString,
  consequencesMd: nullableString,
  newStatus: nullableString,
  reason: nullableString,
  edgeType: {
    type: ['string', 'null'],
    enum: [...PLANNER_EDGE_TYPES, null],
  },
  // Plan C7a: a stack change on a project under way (SET_PROJECT_PROFILE). techStack goes as key/value pairs because
  // strict structured output has no free-form objects; normalizeOperation turns it back into a record.
  description: nullableString,
  objectives: { type: ['array', 'null'], items: { type: 'string' } },
  outOfScope: { type: ['array', 'null'], items: { type: 'string' } },
  techStack: {
    type: ['array', 'null'],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'value'],
      properties: { key: { type: 'string' }, value: { type: 'string' } },
    },
  },
  rules: { type: ['array', 'null'], items: { type: 'string' } },
  verificationCommands: { type: ['array', 'null'], items: { type: 'string' } },
  stackProfileId: { type: ['string', 'null'], enum: [...STACK_PROFILES.map(profile => profile.id), null] },
};
const operationSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(operationProperties),
  properties: operationProperties,
};
/** Codex structured output requires every property to be required and nullable. */
export const strictNullableSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'rationale', 'operations'],
  properties: {
    title: { type: 'string' },
    rationale: { type: 'string' },
    operations: { type: 'array', minItems: 1, items: operationSchema },
  },
};

/** Claude Code accepts a plain JSON schema: only `type` is required and absent fields are simply omitted. */
export const plainSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'rationale', 'operations'],
  properties: {
    title: { type: 'string' },
    rationale: { type: 'string' },
    operations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: Object.fromEntries(
          Object.entries(operationProperties).map(([key, value]) => [key, withoutNull(value)]),
        ),
      },
    },
  },
};

export function withoutNull(value: Record<string, unknown>): Record<string, unknown> {
  const type = Array.isArray(value.type) ? (value.type as string[]).filter(item => item !== 'null') : value.type;
  const result: Record<string, unknown> = { ...value, type: Array.isArray(type) && type.length === 1 ? type[0] : type };
  if (Array.isArray(value.enum)) result.enum = (value.enum as unknown[]).filter(item => item !== null);
  return result;
}
