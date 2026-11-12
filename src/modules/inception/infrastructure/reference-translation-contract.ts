import type { InceptionReferenceTranslationDto, ReferenceKind } from '../../../shared/contracts/inception-view.js';
export { buildReferencePrompt } from './prompts/reference-prompt.js';

/** The three kinds of reference, plus DESIGN: a finished design the user imports as a design direction (looks AND behaviour, nothing dropped). */
export type TranslatorKind = ReferenceKind | 'DESIGN';

/**
 * Engine-independent part of the reference translator: schema, prompt and parsing of its JSON.
 * The translator turns files into text so the rest of the inception can work without seeing them; the rules of each
 * kind (a VISUAL reference is not a list of requirements) are enforced here in code, not only asked of the model.
 */
const strings = { type: 'array', items: { type: 'string' } };
export const referenceTranslationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['references'],
  properties: {
    references: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'summary',
          'palette',
          'typography',
          'layout',
          'screens',
          'actions',
          'flows',
          'states',
          'ideas',
          'openQuestions',
        ],
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          palette: strings,
          typography: { type: 'string' },
          layout: { type: 'string' },
          screens: strings,
          actions: strings,
          flows: strings,
          states: strings,
          ideas: strings,
          openQuestions: strings,
        },
      },
    },
  },
};

export interface TranslatorFile {
  id: string;
  kind: TranslatorKind;
  note: string /** Name of the copy inside the translator's folder (`<id>.<extension>`). */;
  file: string;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = (value: unknown, maxItems: number, max: number) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim().slice(0, max))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

/** Keeps what the reference's kind allows and caps every field; whatever the model added outside its kind is dropped. */
export function normalizeTranslation(kind: TranslatorKind, raw: unknown): InceptionReferenceTranslationDto {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const result: InceptionReferenceTranslationDto = {
    summary: text(item.summary, 700),
    palette: [],
    typography: '',
    layout: '',
    screens: [],
    actions: [],
    flows: [],
    states: [],
    ideas: [],
    openQuestions: list(item.openQuestions, 3, 240),
  };
  if (kind === 'DESIGN') {
    result.palette = list(item.palette, 8, 80);
    result.typography = text(item.typography, 240);
    result.layout = text(item.layout, 400);
    result.screens = list(item.screens, 8, 180);
    result.actions = list(item.actions, 8, 180);
    result.flows = list(item.flows, 8, 240);
    result.states = list(item.states, 8, 180);
  } else if (kind === 'VISUAL') {
    result.palette = list(item.palette, 8, 80);
    result.typography = text(item.typography, 240);
    result.layout = text(item.layout, 400);
  } else if (kind === 'FUNCTIONAL') {
    result.screens = list(item.screens, 8, 180);
    result.actions = list(item.actions, 8, 180);
    result.flows = list(item.flows, 8, 240);
    result.states = list(item.states, 8, 180);
  } else result.ideas = list(item.ideas, 8, 200);
  return result;
}

const isEmpty = (translation: InceptionReferenceTranslationDto) =>
  !translation.summary &&
  !translation.palette.length &&
  !translation.typography &&
  !translation.layout &&
  !translation.screens.length &&
  !translation.actions.length &&
  !translation.flows.length &&
  !translation.states.length &&
  !translation.ideas.length;

/** One result per requested reference, in order; a reference missing from the output, or with nothing readable, comes back with an error. */
export function parseReferenceTranslations(
  output: unknown,
  requested: ReadonlyArray<{ id: string; kind: TranslatorKind }>,
): Array<{ id: string; translation: InceptionReferenceTranslationDto | null; error: string | null }> {
  const items =
    output && typeof output === 'object' && Array.isArray((output as { references?: unknown }).references)
      ? (output as { references: unknown[] }).references
      : [];
  return requested.map(({ id, kind }) => {
    const raw = items.find(item => item && typeof item === 'object' && (item as { id?: unknown }).id === id);
    if (!raw) return { id, translation: null, error: 'El traductor no devolvió esta referencia.' };
    const translation = normalizeTranslation(kind, raw);
    if (isEmpty(translation))
      return { id, translation: null, error: translation.openQuestions[0] ?? 'El traductor no pudo leer el archivo.' };
    return { id, translation, error: null };
  });
}
