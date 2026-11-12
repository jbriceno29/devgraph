import { Script } from 'node:vm';
import type { ChangeSetDraft } from '../../planning/index.js';
import type { UiOptionDraft } from '../application/ports/inception-port.js';
import { MAX_PROTOTYPE_CHARS, type InceptionQuestionDto } from '../../../shared/contracts/inception-view.js';
import { normalizeOperation, operationProperties, withoutNull } from '../../planning/index.js';
import { STACK_PROFILES } from '../../projects/index.js';
import { REPOSITORY_INFERENCE_AREAS } from '../../../shared/contracts/repository-scan.js';
export {
  buildQuestionsPrompt,
  referencesBlock,
  fitScan,
  repositoryBlock,
  changeRequestsBlock,
  uiSpecRule,
  stackRule,
  buildProposalPrompt,
  visualDirectionBlock,
  buildUiExplorationPrompt,
} from './prompts/inception-prompts.js';

/** Engine-independent parts of the inception: schemas, prompts and parsing of each gate's JSON. */
const strings = { type: 'array', items: { type: 'string' } };
export const questionsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['questions', 'assumptions'],
  properties: {
    questions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'options', 'default', 'why'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          options: { type: 'array', maxItems: 6, items: { type: 'string' } },
          default: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    assumptions: strings,
  },
};
/** The questions gate of a brownfield project: the same, plus what the assistant infers from the repository scan, each inference with its evidence paths. */
export const brownfieldQuestionsSchema = {
  ...questionsSchema,
  required: ['questions', 'assumptions', 'inferences'],
  properties: {
    ...questionsSchema.properties,
    inferences: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'statement', 'evidence'],
        properties: {
          area: { type: 'string', enum: [...REPOSITORY_INFERENCE_AREAS] },
          statement: { type: 'string' },
          evidence: { type: 'array', maxItems: 5, items: { type: 'string' } },
        },
      },
    },
  },
};
const profileProperties = {
  description: { type: 'string' },
  objectives: strings,
  outOfScope: strings,
  techStack: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'value'],
      properties: { key: { type: 'string' }, value: { type: 'string' } },
    },
  },
  rules: strings,
  verificationCommands: strings,
  stackProfileId: { type: 'string', enum: STACK_PROFILES.map(profile => profile.id) },
};
const operationTypes = [
  'SET_PROJECT_PROFILE',
  'CREATE_MODULE',
  'CREATE_FEATURE',
  'CREATE_REQUIREMENT',
  'CREATE_WORK_ITEM',
  'CREATE_DECISION_RECORD',
  'UPSERT_ARTIFACT',
  'CREATE_RELATIONSHIP',
];
const inceptionOperation = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    ...Object.fromEntries(
      Object.entries(operationProperties)
        .filter(([key]) => !['entityId', 'edgeId', 'newStatus', 'reason'].includes(key))
        .map(([key, value]) => [key, withoutNull(value)]),
    ),
    type: { type: 'string', enum: operationTypes },
    ...profileProperties,
  },
};
export const uiExplorationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['options', 'assumptions'],
  properties: {
    options: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'navigation', 'screens', 'designSystemNotes', 'prototypeHtml'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          navigation: { type: 'string' },
          screens: strings,
          designSystemNotes: strings,
          prototypeHtml: { type: 'string' },
        },
      },
    },
    assumptions: strings,
  },
};
export const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'rationale', 'assumptions', 'operations'],
  properties: {
    title: { type: 'string' },
    rationale: { type: 'string' },
    assumptions: strings,
    operations: { type: 'array', minItems: 1, items: inceptionOperation },
  },
};

export function parseQuestions(
  value: unknown,
  engine: string,
): { questions: InceptionQuestionDto[]; assumptions: string[]; inferences: unknown[] } {
  const data = value as { questions?: unknown; assumptions?: unknown; inferences?: unknown } | null;
  if (!data || !Array.isArray(data.questions)) throw new Error(`${engine} no devolvió preguntas.`);
  const questions = data.questions.flatMap((item, index): InceptionQuestionDto[] => {
    const question = item as Record<string, unknown> | null;
    const text = typeof question?.text === 'string' ? question.text.trim() : '';
    if (!text) return [];
    const options = Array.isArray(question!.options)
      ? question!.options
          .map(String)
          .map(option => option.trim())
          .filter(Boolean)
      : [];
    const fallback = typeof question!.default === 'string' ? question!.default.trim() : '';
    return [
      {
        id: typeof question!.id === 'string' && question!.id.trim() ? question!.id.trim() : `q${index + 1}`,
        text,
        options,
        default: options.includes(fallback) ? fallback : null,
        why: typeof question!.why === 'string' ? question!.why.trim() : '',
      },
    ];
  });
  return {
    questions: questions.slice(0, 5),
    assumptions: Array.isArray(data.assumptions) ? data.assumptions.map(String).filter(Boolean) : [],
    inferences: Array.isArray(data.inferences) ? data.inferences : [],
  };
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const texts = (value: unknown, maxItems: number, max: number) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim().slice(0, max))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
const LOOKS_LIKE_HTML = /<\s*(?:!doctype|html|body|head|div|main|section|header)\b/i;

/**
 * Whether every inline classic script of a prototype compiles. `vm.Script` only parses (nothing runs). A single syntax error leaves the whole
 * prototype blank, and a model writing compact code did exactly that in 3 of 3 prototypes of one measured run, so such an option is dropped
 * instead of being shown as an empty page. Scripts with `src`, modules and data blocks (JSON, templates) are not JavaScript to compile here.
 */
export function inlineScriptsCompile(html: string): boolean {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] ?? '';
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
    if (type && !/^(?:text\/javascript|application\/javascript|text\/ecmascript)$/.test(type)) continue;
    try {
      new Script(match[2] ?? '');
    } catch {
      return false;
    }
  }
  return true;
}

/** The options of the engine's answer. An option without a usable prototype (not HTML, too short or too long) is dropped; none usable is an error. */
export function parseUiOptions(
  value: unknown,
  engine: string,
  limit = 3,
): { options: UiOptionDraft[]; assumptions: string[] } {
  const data = value as { options?: unknown; assumptions?: unknown } | null;
  if (!data || !Array.isArray(data.options)) throw new Error(`${engine} no devolvió direcciones visuales.`);
  const options = data.options
    .flatMap((item): UiOptionDraft[] => {
      const option = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const html = typeof option.prototypeHtml === 'string' ? option.prototypeHtml.trim() : '';
      if (
        html.length < 200 ||
        html.length > MAX_PROTOTYPE_CHARS ||
        !LOOKS_LIKE_HTML.test(html) ||
        !inlineScriptsCompile(html)
      )
        return [];
      return [
        {
          title: text(option.title, 80) || 'Dirección visual',
          summary: text(option.summary, 500),
          navigation: text(option.navigation, 500),
          screens: texts(option.screens, 10, 120),
          designSystemNotes: texts(option.designSystemNotes, 10, 200),
          prototypeHtml: html,
        },
      ];
    })
    .slice(0, limit);
  if (!options.length)
    throw new Error(
      `${engine} no devolvió ningún prototipo utilizable (un documento HTML completo de hasta ${MAX_PROTOTYPE_CHARS.toLocaleString('es')} caracteres y con JavaScript sin errores de sintaxis). Vuelve a intentarlo.`,
    );
  return { options, assumptions: Array.isArray(data.assumptions) ? data.assumptions.map(String).filter(Boolean) : [] };
}

export function parseProposal(value: unknown, engine: string): { draft: ChangeSetDraft; assumptions: string[] } {
  const data = value as { title?: unknown; rationale?: unknown; assumptions?: unknown; operations?: unknown } | null;
  if (!data || !Array.isArray(data.operations) || !data.operations.length)
    throw new Error(`${engine} devolvió una propuesta de inicio sin operaciones.`);
  const operations = data.operations.map(item => normalizeOperation(item, engine));
  return {
    draft: {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Inicio del proyecto',
      rationale: typeof data.rationale === 'string' ? data.rationale : '',
      operations,
    },
    assumptions: Array.isArray(data.assumptions) ? data.assumptions.map(String).filter(Boolean) : [],
  };
}
