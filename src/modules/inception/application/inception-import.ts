import {
  DESIGN_IMAGE_EXTENSIONS,
  type InceptionViewDto,
  MAX_PROTOTYPE_CHARS,
  MAX_UI_OPTIONS,
} from '../../../shared/contracts/inception-view.js';
import { get } from './inception-flow.js';
import {
  CONVERT_REACT_NOTE,
  HTML_START,
  type InceptionKernel,
  displayName,
  nextUiId,
  projectInput,
  requireExploring,
  requireProject,
  toUiOption,
  translationModel,
  uiModel,
} from './inception-kernel.js';
import { launch } from './inception-work.js';
import type { InceptionRecord, InceptionUiOption } from './ports/inception-port.js';
import { prepareReferences } from './reference-files.js';

/** Adds a prototype the user made elsewhere (for example exported from Claude Artifacts or Claude Design) as one more direction. No engine call. */
export function importPrototype(
  k: InceptionKernel,
  projectId: string,
  input: { name: string; html: string },
): InceptionViewDto {
  const current = requireExploring(k, projectId);
  if (current.ui.options.length >= MAX_UI_OPTIONS)
    throw new Error(`Puedes tener como mucho ${MAX_UI_OPTIONS} direcciones; ajusta una de las existentes.`);
  const name = displayName(input?.name);
  const html = typeof input?.html === 'string' ? input.html.trim() : '';
  if (!html) throw new Error('El prototipo está vacío.');
  if (html.length > MAX_PROTOTYPE_CHARS)
    throw new Error(
      `El prototipo supera los ${MAX_PROTOTYPE_CHARS.toLocaleString('es')} caracteres; pega uno más pequeño.`,
    );
  if (html.includes('\u0000') || !HTML_START.test(html))
    throw new Error('Eso no parece un documento HTML. Pega o sube el archivo .html del prototipo.');
  const title =
    (/<title[^>]*>([^<]{1,80})<\/title>/i.exec(html)?.[1] ?? name.replace(/\.[a-z0-9]+$/i, '')).trim() ||
    'Prototipo importado';
  const option = toUiOption(
    k,
    {
      title,
      summary: 'Prototipo importado por ti. Míralo y pide ajustes si quieres que el asistente lo adapte.',
      navigation: '',
      screens: [],
      designSystemNotes: [],
      prototypeHtml: html,
    },
    'IMPORTED',
    nextUiId(k, current.ui.options),
  );
  k.deps.store.save({
    ...current,
    error: null,
    ui: { ...current.ui, options: [...current.ui.options, option] },
    updatedAt: new Date().toISOString(),
  });
  return get(k, projectId);
}

/**
 * Adds a finished design made elsewhere. A picture (`IMAGE`) is described in text by the translator and becomes a direction with no prototype yet;
 * React code (`REACT`) is converted by the engine into a self-contained HTML prototype. Either way the user waits for a model; a failure leaves the
 * directions as they were, with the reason.
 */
export function importDesign(
  k: InceptionKernel,
  projectId: string,
  input: { name: string; kind: 'IMAGE' | 'REACT'; content: string },
): InceptionViewDto {
  const current = requireExploring(k, projectId),
    project = requireProject(k, projectId);
  if (current.ui.options.length >= MAX_UI_OPTIONS)
    throw new Error(`Puedes tener como mucho ${MAX_UI_OPTIONS} direcciones; ajusta una de las existentes.`);
  const name = displayName(input?.name),
    id = nextUiId(k, current.ui.options);
  if (input?.kind === 'IMAGE') importImage(k, projectId, current, name, id, String(input.content ?? ''));
  else if (input?.kind === 'REACT') importReact(k, projectId, current, project, name, id, reactSource(input.content));
  else throw new Error('Importa una imagen o código React.');
  return get(k, projectId);
}

/** A picture of a design: the translator describes it and it becomes a direction without prototype yet. */
function importImage(
  k: InceptionKernel,
  projectId: string,
  current: InceptionRecord,
  name: string,
  id: string,
  content: string,
): void {
  const { translator, referenceFiles } = k.deps;
  if (!translator || !referenceFiles) throw new Error('Esta versión de la app no puede analizar imágenes.');
  const [prepared] = prepareReferences([{ name, kind: 'VISUAL', note: '', dataBase64: content }]);
  const extension = prepared!.file.slice(prepared!.file.lastIndexOf('.') + 1);
  if (!DESIGN_IMAGE_EXTENSIONS.includes(extension))
    throw new Error(`«${name}»: importa una imagen (${DESIGN_IMAGE_EXTENSIONS.join(', ')}).`);
  const file = `design-${id.replace(/\D/g, '')}.${extension}`;
  referenceFiles.save(projectId, file, prepared!.content);
  const record: InceptionRecord = { ...current, status: 'WORKING', error: null, updatedAt: new Date().toISOString() };
  k.deps.store.save(record);
  launch(
    k,
    record,
    async signal => {
      const out = await translator.translate({
        files: [
          {
            id: `design-${id.replace(/\D/g, '')}`,
            kind: 'DESIGN',
            note: '',
            mimeType: prepared!.mimeType,
            path: referenceFiles.pathOf(projectId, file),
          },
        ],
        ...translationModel(k, projectId),
        signal,
      });
      const understood = out.results[0]?.translation;
      if (!understood)
        throw new Error(
          `No se pudo analizar «${name}»: ${(out.results[0]?.error ?? 'el traductor no devolvió nada').replace(/\.+$/, '')}.`,
        );
      const option = imageOption(id, name, understood, prepared!, file);
      return {
        stage: 'EXPLORE_UI' as const,
        status: 'WAITING_USER' as const,
        ui: { ...record.ui, options: [...record.ui.options, option] },
        usage: out.usage,
      };
    },
    'EXPLORE_UI',
    'WAITING_USER',
  );
}

type Translation = NonNullable<
  Awaited<ReturnType<NonNullable<InceptionKernel['deps']['translator']>['translate']>>['results'][number]['translation']
>;

/** The direction a translated design image becomes: its description, notes and the image itself. */
function imageOption(
  id: string,
  name: string,
  understood: Translation,
  prepared: { bytes: number; mimeType: string },
  file: string,
): InceptionUiOption {
  const notes = [
    ...understood.palette.map(color => `Paleta: ${color}`),
    ...(understood.typography ? [`Tipografía: ${understood.typography}`] : []),
    ...(understood.layout ? [`Composición: ${understood.layout}`] : []),
    ...understood.states.map(state => `Estado: ${state}`),
  ];
  return {
    id,
    title: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'Diseño importado',
    summary: understood.summary,
    navigation: (understood.flows.length ? understood.flows : understood.actions).slice(0, 3).join(' · '),
    screens: understood.screens,
    designSystemNotes: notes.slice(0, 10),
    source: 'IMAGE',
    htmlBytes: prepared.bytes,
    externalReferences: [],
    prototypeHtml: '',
    imageFile: file,
    imageMime: prepared.mimeType,
  };
}

/** The pasted React component, or a Spanish error when it is empty, too big, HTML or not JSX at all. */
function reactSource(content: unknown): string {
  const source = typeof content === 'string' ? content.trim() : '';
  if (!source) throw new Error('El código está vacío.');
  if (source.length > MAX_PROTOTYPE_CHARS)
    throw new Error(
      `El código supera los ${MAX_PROTOTYPE_CHARS.toLocaleString('es')} caracteres; pega un componente más pequeño.`,
    );
  if (source.includes('\u0000')) throw new Error('Eso no parece código React (JSX).');
  if (/^\s*<!doctype html|<html[\s>]/i.test(source))
    throw new Error('Eso parece un documento HTML completo: impórtalo como HTML.');
  if (!source.includes('<') || !/\b(?:function|import|export|return)\b|=>/.test(source))
    throw new Error('Eso no parece código React (JSX). Pega o sube el archivo .jsx o .tsx del componente.');
  return source;
}

/** A React component: the engine converts it into one self-contained HTML prototype with the same design. */
function importReact(
  k: InceptionKernel,
  projectId: string,
  current: InceptionRecord,
  project: ReturnType<typeof requireProject>,
  name: string,
  id: string,
  source: string,
): void {
  const record: InceptionRecord = { ...current, status: 'WORKING', error: null, updatedAt: new Date().toISOString() };
  k.deps.store.save(record);
  launch(
    k,
    record,
    async signal => {
      const result = await k.deps.engine.exploreUi({
        project: projectInput(
          k,
          projectId,
          record.brief,
          project.props,
          record.references ?? [],
          undefined,
          record.repository,
        ),
        questions: record.questions,
        answers: record.answers,
        ...uiModel(k, record),
        revise: {
          option: {
            title: name.replace(/\.[a-z0-9]+$/i, '') || 'Componente React',
            summary: '',
            navigation: '',
            screens: [],
            designSystemNotes: [],
            prototypeHtml: source,
          },
          notes: [CONVERT_REACT_NOTE],
        },
        signal,
      });
      const draft = result.options[0];
      if (!draft) throw new Error('El asistente no devolvió el prototipo convertido.');
      return {
        stage: 'EXPLORE_UI' as const,
        status: 'WAITING_USER' as const,
        ui: { ...record.ui, options: [...record.ui.options, toUiOption(k, draft, 'IMPORTED', id)] },
        usage: result.usage,
      };
    },
    'EXPLORE_UI',
    'WAITING_USER',
  );
}
