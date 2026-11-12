import type { ChangeSet, ChangeOperation } from '../../domain/knowledge/change-set.js';
import { DEFAULT_DECISION_POLICY, decide } from '../../domain/autonomy/decision-policy.js';
import type { ProjectRepositoryPort } from '../ports/project-repository-port.js';
import type { KnowledgeGraphRepositoryPort } from '../ports/knowledge-graph-repository-port.js';
import type { ChangeSetDraft } from '../ports/change-set-planning-port.js';
import {
  EMPTY_UI_STATE,
  type InceptionEnginePort,
  type InceptionEngineUsage,
  type InceptionRecord,
  type InceptionReference,
  type InceptionReferenceFilesPort,
  type InceptionRepositoryPort,
  type InceptionRepositoryState,
  type InceptionUiOption,
  type ReferenceTranslatorPort,
  type UiOptionDraft,
} from '../ports/inception-port.js';
import type { RepositoryScannerPort } from '../ports/repository-scan-port.js';
import { summarizeScan } from '../../shared/contracts/repository-scan.js';
import { normalizeInferences } from './repository-evidence.js';
import { accessView, editedRepository, withAgentAccess } from './repository-access.js';
import { findExternalReferences } from '../../shared/prototype-safety.js';
import { prepareReferences } from './reference-files.js';
import {
  DESIGN_IMAGE_EXTENSIONS,
  MAX_INCEPTION_NOTE,
  MAX_PROTOTYPE_CHARS,
  MAX_UI_OPTIONS,
  type InceptionActivityDto,
  type InceptionAnswerDto,
  type InceptionNextAction,
  type InceptionProposalDto,
  type InceptionStage,
  type InceptionStatus,
  type InceptionViewDto,
  type StartInceptionInput,
} from '../../shared/contracts/inception-view.js';
import { buildFoundationPlan, scaffoldTempId, summarizeFoundationPlan } from './foundation-plan.js';

/** The ChangeSet flow the inception reuses (validation, review and application are the same as any other proposal). */
export interface InceptionPlanningPort {
  submit(projectId: string, draft: ChangeSetDraft, originRefId: string): ChangeSet;
  find(changeSetId: string): ChangeSet | null;
  /** `resolvedIds` maps each tempId to the graph id it got (the scaffold task's id is kept from it). */
  apply(changeSetId: string): Promise<{ revision: number; resolvedIds?: Record<string, string> }>;
  reject(changeSetId: string): void;
}
/** Saves the approved prototype in the repository; returns its relative path. */
export interface DesignPrototypeWriterPort {
  write(repositoryPath: string, html: string): Promise<string>;
}
export interface ProjectInceptionDependencies {
  projects: ProjectRepositoryPort;
  graph: KnowledgeGraphRepositoryPort;
  store: InceptionRepositoryPort;
  engine: InceptionEnginePort;
  planning: InceptionPlanningPort;
  repositoryPath(projectId: string): string | null;
  /** Planning model of the wired provider (decision 6: opus) and the aliases it accepts. */
  models(projectId: string): { planning: string | null; available: string[] };
  /** Translates attached references to text, and where they are stored. Without them the assistant refuses references (it cannot read files itself). */
  translator?: ReferenceTranslatorPort;
  referenceFiles?: InceptionReferenceFilesPort;
  designFiles?: DesignPrototypeWriterPort;
  /** Brownfield mode: reads the configured repository when the inception starts; when it already has code, the assistant works from that evidence. */
  scanner?: RepositoryScannerPort;
  emit?(channel: 'inception:updated' | 'graph:revision_updated', payload: unknown): void;
}

const MAX_QUESTIONS = 5,
  MAX_BRIEF = 4000,
  MAX_ANSWER = 1000,
  MAX_NOTES = 5;
const INTERRUPTED = 'La llamada se interrumpió (la app se cerró). Vuelve a intentarlo.';
const HTML_START = /<\s*(?:!doctype|html|body|head|div|main|section|header)\b/i;
/** What the engine is told when the imported thing is React code: convert it, do not redesign it. */
const CONVERT_REACT_NOTE =
  'Lo que hay en "prototypeHtml" NO es HTML: es el código de un componente React (JSX). Conviértelo en UN documento HTML autocontenido, sin React ni ninguna dependencia, con el mismo diseño y el mismo comportamiento: reescribe la interactividad con JavaScript sencillo y mantén el estado en memoria. Si no tienes un título mejor, usa el nombre del componente.';
/** What the engine is told when a direction comes from a picture and has no prototype yet. */
const IMAGE_TO_PROTOTYPE_NOTE =
  'Esta dirección viene de la imagen de un diseño ya hecho y todavía no tiene prototipo (no hay HTML). Crea un prototipo HTML interactivo que la reproduzca con fidelidad a partir de su descripción (paleta, tipografía, composición, pantallas y estados), y aplica además estos cambios:';
const imagePage = (mime: string, bytes: Buffer) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>html,body{margin:0;background:#f4f4f5}img{display:block;max-width:100%;height:auto;margin:0 auto}</style></head><body><img alt="Imagen del diseño importado" src="data:${mime};base64,${bytes.toString('base64')}"></body></html>`;
const displayName = (value: unknown) =>
  String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);

/**
 * Project inception (MVP with two gates, plus an optional visual exploration): ASK_GOALS → [EXPLORE_UI] → PROPOSAL (waiting for approval) → APPLIED. Engine calls run in
 * the background (the IPC call returns at once with status WORKING; `inception:updated` reports the end) and each one
 * is independent: brief, questions, answers and the proposal live in the workspace, never in an engine session.
 * The proposal is a normal ChangeSet: validated, classified by the decision policy (PROJECT_FOUNDATION always asks)
 * and applied only when the user approves it. A restart or the app shutdown aborts the running call (its process is stopped).
 */
export class ProjectInceptionService {
  private readonly running = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  constructor(private readonly deps: ProjectInceptionDependencies) {}

  get(projectId: string): InceptionViewDto {
    return this.view(projectId, this.record(projectId));
  }

  start(projectId: string, input: StartInceptionInput): InceptionViewDto {
    const project = this.requireProject(projectId),
      current = this.record(projectId);
    if (current && !(current.stage === 'ASK_GOALS' && current.status === 'FAILED' && !current.questions.length))
      throw new Error('El inicio del proyecto ya empezó. Continúa donde lo dejaste o reinícialo.');
    if (
      this.deps.graph
        .listEntities(projectId)
        .some(entity => entity.entityType === 'FEATURE' || entity.entityType === 'WORK_ITEM')
    )
      throw new Error('El proyecto ya tiene un plan; el asistente de inicio es para proyectos vacíos.');
    const brief = String(input?.brief ?? '').trim();
    if (!brief) throw new Error('Describe en pocas líneas qué quieres construir.');
    if (brief.length > MAX_BRIEF) throw new Error(`La descripción admite como mucho ${MAX_BRIEF} caracteres.`);
    const model = this.chooseModel(projectId, input?.model),
      now = new Date().toISOString();
    // New references replace the stored ones; on a retry after a failure none are sent and the stored ones (and what was already translated) are reused.
    let references: InceptionReference[] = current?.references ?? [];
    if (Array.isArray(input?.references) && input.references.length) {
      const prepared = prepareReferences(input.references);
      if (!this.deps.referenceFiles || !this.deps.translator)
        throw new Error('Esta versión de la app no puede analizar referencias.');
      this.deps.referenceFiles.deleteAll(projectId);
      for (const item of prepared) this.deps.referenceFiles.save(projectId, item.file, item.content);
      references = prepared.map(
        ({ content: _content, ...rest }): InceptionReference => ({
          ...rest,
          status: 'PENDING',
          error: null,
          translation: null,
        }),
      );
    }
    const record: InceptionRecord = {
      projectId,
      stage: 'ASK_GOALS',
      status: 'WORKING',
      brief,
      questions: [],
      answers: [],
      assumptions: [],
      changeSetId: null,
      model,
      usage: current?.usage ?? [],
      error: null,
      notes: [],
      scaffoldTaskId: null,
      references,
      ui: EMPTY_UI_STATE,
      repository: null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.deps.store.save(record);
    this.launch(
      record,
      async signal => {
        // Brownfield: a repository that already has code is read first (nothing runs), and everything after works from that evidence.
        const repository = await this.scanRepository(record, signal);
        const understood = await this.translateReferences(record, signal);
        const result = await this.deps.engine.askGoals({
          project: this.projectInput(projectId, brief, project.props, understood, undefined, repository),
          ...(model ? { model } : {}),
          signal,
        });
        const questions = result.questions.slice(0, MAX_QUESTIONS).map((question, index) => ({
          ...question,
          id: question.id?.trim() || `q${index + 1}`,
          options: question.options.slice(0, 6),
          default: question.default && question.options.includes(question.default) ? question.default : null,
        }));
        return {
          stage: 'ASK_GOALS',
          status: 'WAITING_USER',
          questions,
          assumptions: result.assumptions,
          repository: repository
            ? { ...repository, inferences: normalizeInferences(result.inferences, repository.scan) }
            : null,
          usage: result.usage,
        };
      },
      'ASK_GOALS',
    );
    return this.get(projectId);
  }

  /**
   * Answers the questions and asks for the proposal; in PROPOSAL it regenerates it (the previous one is rejected).
   * `notes` (PROPOSAL only) is what the user wants changed: it is kept, with earlier ones, for every later regeneration.
   */
  answer(
    projectId: string,
    answers: InceptionAnswerDto[],
    notes?: string | null,
    options?: {
      exploreUi?: boolean /** Brownfield: corrections of the inferences and the agent's access (each replaces the earlier one). */;
      corrections?: unknown;
      access?: unknown;
    },
  ): InceptionViewDto {
    const project = this.requireProject(projectId),
      current = this.record(projectId);
    if (!current || current.status === 'WORKING' || current.stage === 'APPLIED' || current.status === 'DONE')
      throw new Error(
        !current
          ? 'Empieza primero el inicio del proyecto.'
          : current.status === 'WORKING'
            ? 'Espera a que termine la llamada en curso.'
            : 'El inicio del proyecto ya se aplicó.',
      );
    if (current.stage === 'ASK_GOALS' && current.status === 'FAILED' && !current.questions.length)
      throw new Error('Las preguntas no se generaron; vuelve a empezar.');
    if (current.stage === 'EXPLORE_UI')
      throw new Error('Elige una dirección visual (o salta el diseño) antes de seguir.');
    const known = new Map(current.questions.map(question => [question.id, question]));
    const given = new Map<string, string>();
    for (const item of Array.isArray(answers) ? answers : []) {
      const id = String(item?.questionId ?? '');
      if (!known.has(id)) throw new Error(`La respuesta no corresponde a ninguna pregunta: ${id || '(vacía)'}.`);
      const text = String(item?.answer ?? '').trim();
      if (text.length > MAX_ANSWER) throw new Error(`Cada respuesta admite como mucho ${MAX_ANSWER} caracteres.`);
      given.set(id, text);
    }
    const note =
      typeof notes === 'string' ? notes.trim() : notes === undefined || notes === null ? '' : String(notes).trim();
    if (note.length > MAX_INCEPTION_NOTE)
      throw new Error(`Lo que quieres cambiar admite como mucho ${MAX_INCEPTION_NOTE} caracteres.`);
    if (note && current.stage !== 'PROPOSAL')
      throw new Error('Los cambios se piden sobre una propuesta ya preparada; responde primero las preguntas.');
    const allNotes = note ? [...(current.notes ?? []), note].slice(-MAX_NOTES) : (current.notes ?? []);
    const repository = editedRepository(current.repository, options);
    const normalized = current.questions.map(question => ({
      questionId: question.id,
      answer: given.get(question.id) ?? current.answers.find(answer => answer.questionId === question.id)?.answer ?? '',
    }));
    if (current.changeSetId) {
      const previous = this.deps.planning.find(current.changeSetId);
      if (previous && !['APPLIED', 'REJECTED'].includes(previous.status)) this.deps.planning.reject(previous.id);
    }
    // From the questions the user may ask to see design directions first; a retry keeps what they asked for.
    const exploring = current.stage === 'ASK_GOALS' && (options?.exploreUi ?? current.ui.wanted);
    const record: InceptionRecord = {
      ...current,
      status: 'WORKING',
      answers: normalized,
      notes: allNotes,
      repository,
      changeSetId: null,
      error: null,
      ui:
        current.stage === 'ASK_GOALS'
          ? { ...current.ui, wanted: exploring, options: exploring ? [] : current.ui.options }
          : current.ui,
      updatedAt: new Date().toISOString(),
    };
    this.deps.store.save(record);
    if (exploring) this.launch(record, signal => this.exploreWork(record, project.props, signal), current.stage);
    else this.launch(record, signal => this.proposalWork(record, project.props, signal), current.stage);
    return this.get(projectId);
  }

  /** Adds a prototype the user made elsewhere (for example exported from Claude Artifacts or Claude Design) as one more direction. No engine call. */
  importPrototype(projectId: string, input: { name: string; html: string }): InceptionViewDto {
    const current = this.requireExploring(projectId);
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
    const option = this.toUiOption(
      {
        title,
        summary: 'Prototipo importado por ti. Míralo y pide ajustes si quieres que el asistente lo adapte.',
        navigation: '',
        screens: [],
        designSystemNotes: [],
        prototypeHtml: html,
      },
      'IMPORTED',
      this.nextUiId(current.ui.options),
    );
    this.deps.store.save({
      ...current,
      error: null,
      ui: { ...current.ui, options: [...current.ui.options, option] },
      updatedAt: new Date().toISOString(),
    });
    return this.get(projectId);
  }

  /**
   * Adds a finished design made elsewhere. A picture (`IMAGE`) is described in text by the translator and becomes a direction with no prototype yet;
   * React code (`REACT`) is converted by the engine into a self-contained HTML prototype. Either way the user waits for a model; a failure leaves the
   * directions as they were, with the reason.
   */
  importDesign(projectId: string, input: { name: string; kind: 'IMAGE' | 'REACT'; content: string }): InceptionViewDto {
    const current = this.requireExploring(projectId),
      project = this.requireProject(projectId);
    if (current.ui.options.length >= MAX_UI_OPTIONS)
      throw new Error(`Puedes tener como mucho ${MAX_UI_OPTIONS} direcciones; ajusta una de las existentes.`);
    const name = displayName(input?.name),
      id = this.nextUiId(current.ui.options);
    if (input?.kind === 'IMAGE') {
      const { translator, referenceFiles } = this.deps;
      if (!translator || !referenceFiles) throw new Error('Esta versión de la app no puede analizar imágenes.');
      const [prepared] = prepareReferences([
        { name, kind: 'VISUAL', note: '', dataBase64: String(input.content ?? '') },
      ]);
      const extension = prepared!.file.slice(prepared!.file.lastIndexOf('.') + 1);
      if (!DESIGN_IMAGE_EXTENSIONS.includes(extension))
        throw new Error(`«${name}»: importa una imagen (${DESIGN_IMAGE_EXTENSIONS.join(', ')}).`);
      const file = `design-${id.replace(/\D/g, '')}.${extension}`;
      referenceFiles.save(projectId, file, prepared!.content);
      const record: InceptionRecord = {
        ...current,
        status: 'WORKING',
        error: null,
        updatedAt: new Date().toISOString(),
      };
      this.deps.store.save(record);
      this.launch(
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
            ...this.translationModel(projectId),
            signal,
          });
          const understood = out.results[0]?.translation;
          if (!understood)
            throw new Error(
              `No se pudo analizar «${name}»: ${(out.results[0]?.error ?? 'el traductor no devolvió nada').replace(/\.+$/, '')}.`,
            );
          const notes = [
            ...understood.palette.map(color => `Paleta: ${color}`),
            ...(understood.typography ? [`Tipografía: ${understood.typography}`] : []),
            ...(understood.layout ? [`Composición: ${understood.layout}`] : []),
            ...understood.states.map(state => `Estado: ${state}`),
          ];
          const option: InceptionUiOption = {
            id,
            title: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'Diseño importado',
            summary: understood.summary,
            navigation: (understood.flows.length ? understood.flows : understood.actions).slice(0, 3).join(' · '),
            screens: understood.screens,
            designSystemNotes: notes.slice(0, 10),
            source: 'IMAGE',
            htmlBytes: prepared!.bytes,
            externalReferences: [],
            prototypeHtml: '',
            imageFile: file,
            imageMime: prepared!.mimeType,
          };
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
      return this.get(projectId);
    }
    if (input?.kind === 'REACT') {
      const source = typeof input.content === 'string' ? input.content.trim() : '';
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
      const record: InceptionRecord = {
        ...current,
        status: 'WORKING',
        error: null,
        updatedAt: new Date().toISOString(),
      };
      this.deps.store.save(record);
      this.launch(
        record,
        async signal => {
          const result = await this.deps.engine.exploreUi({
            project: this.projectInput(
              projectId,
              record.brief,
              project.props,
              record.references ?? [],
              undefined,
              record.repository,
            ),
            questions: record.questions,
            answers: record.answers,
            ...this.uiModel(record),
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
            ui: { ...record.ui, options: [...record.ui.options, this.toUiOption(draft, 'IMPORTED', id)] },
            usage: result.usage,
          };
        },
        'EXPLORE_UI',
        'WAITING_USER',
      );
      return this.get(projectId);
    }
    throw new Error('Importa una imagen o código React.');
  }

  /** Regenerates one direction with the user's change requests; the others stay. A failure leaves everything as it was, with the reason. */
  reviseUiOption(projectId: string, optionId: string, notes: string): InceptionViewDto {
    const current = this.requireExploring(projectId),
      project = this.requireProject(projectId);
    const option = current.ui.options.find(item => item.id === optionId);
    if (!option) throw new Error('Esa dirección visual ya no existe.');
    const note = String(notes ?? '').trim();
    if (!note) throw new Error('Cuéntale al asistente qué quieres cambiar de este prototipo.');
    if (note.length > MAX_INCEPTION_NOTE)
      throw new Error(`Lo que quieres cambiar admite como mucho ${MAX_INCEPTION_NOTE} caracteres.`);
    const record: InceptionRecord = { ...current, status: 'WORKING', error: null, updatedAt: new Date().toISOString() };
    this.deps.store.save(record);
    this.launch(
      record,
      async signal => {
        const { prototypeHtml, title, summary, navigation, screens, designSystemNotes } = option;
        // A direction that comes from a picture has no HTML: adjusting it asks the engine to build the prototype from its description.
        const notes = option.source === 'IMAGE' ? [`${IMAGE_TO_PROTOTYPE_NOTE} ${note}`] : [note];
        const result = await this.deps.engine.exploreUi({
          project: this.projectInput(
            projectId,
            record.brief,
            project.props,
            record.references ?? [],
            undefined,
            record.repository,
          ),
          questions: record.questions,
          answers: record.answers,
          ...this.uiModel(record),
          revise: { option: { title, summary, navigation, screens, designSystemNotes, prototypeHtml }, notes },
          signal,
        });
        const draft = result.options[0];
        if (!draft) throw new Error('El asistente no devolvió el prototipo ajustado.');
        return {
          stage: 'EXPLORE_UI',
          status: 'WAITING_USER',
          ui: {
            ...record.ui,
            options: record.ui.options.map(item =>
              item.id === optionId
                ? this.toUiOption(draft, item.source === 'IMAGE' ? 'GENERATED' : item.source, item.id)
                : item,
            ),
          },
          usage: result.usage,
        };
      },
      'EXPLORE_UI',
      'WAITING_USER',
    );
    return this.get(projectId);
  }

  /** Approves a direction and asks for the proposal built on it; `null` skips the design and goes straight to the plan. */
  chooseUiOption(projectId: string, optionId: string | null): InceptionViewDto {
    const current = this.requireExploring(projectId),
      project = this.requireProject(projectId);
    if (optionId !== null && !current.ui.options.some(item => item.id === optionId))
      throw new Error('Esa dirección visual ya no existe.');
    // While the proposal is prepared the inception is in the proposal gate; if that fails it comes back to choosing, with the reason and the selection kept.
    const record: InceptionRecord = {
      ...current,
      stage: 'PROPOSAL',
      status: 'WORKING',
      error: null,
      changeSetId: null,
      ui: { ...current.ui, selectedOptionId: optionId },
      updatedAt: new Date().toISOString(),
    };
    this.deps.store.save(record);
    this.launch(record, signal => this.proposalWork(record, project.props, signal), 'EXPLORE_UI', 'WAITING_USER');
    return this.get(projectId);
  }

  /**
   * Back from the proposal to the design step: the directions already generated (with the choice kept), or — when the design was never asked for —
   * generated now from the same answers. The pending proposal is rejected; a new one is prepared when a direction is approved or the design skipped.
   */
  reopenDesign(projectId: string): InceptionViewDto {
    const current = this.record(projectId),
      project = this.requireProject(projectId);
    if (!current || current.stage !== 'PROPOSAL' || current.status !== 'WAITING_USER')
      throw new Error('Solo puedes volver al diseño mientras revisas la propuesta.');
    if (current.changeSetId) {
      const pending = this.deps.planning.find(current.changeSetId);
      if (pending && !['APPLIED', 'REJECTED'].includes(pending.status)) this.deps.planning.reject(pending.id);
    }
    const now = new Date().toISOString();
    if (current.ui.options.length) {
      this.deps.store.save({
        ...current,
        stage: 'EXPLORE_UI',
        status: 'WAITING_USER',
        changeSetId: null,
        error: null,
        ui: { ...current.ui, wanted: true },
        updatedAt: now,
      });
      return this.get(projectId);
    }
    // Never explored: it behaves like asking for it with the questions (the first gate again), so a failure offers «Reintentar las direcciones visuales».
    const record: InceptionRecord = {
      ...current,
      stage: 'ASK_GOALS',
      status: 'WORKING',
      changeSetId: null,
      error: null,
      ui: { ...current.ui, wanted: true, options: [], selectedOptionId: null },
      updatedAt: now,
    };
    this.deps.store.save(record);
    this.launch(record, signal => this.exploreWork(record, project.props, signal), 'ASK_GOALS');
    return this.get(projectId);
  }

  /** The HTML of a direction's prototype (the view does not carry it: it is polled while the engine works). */
  getUiPrototype(projectId: string, optionId: string): string {
    this.requireProject(projectId);
    const option = this.record(projectId)?.ui.options.find(item => item.id === optionId);
    if (!option) throw new Error('Esa dirección visual ya no existe.');
    if (option.imageFile) {
      if (!this.deps.referenceFiles) throw new Error('No se puede leer la imagen de esta dirección.');
      return imagePage(option.imageMime ?? 'image/png', this.deps.referenceFiles.read(projectId, option.imageFile));
    }
    return option.prototypeHtml;
  }

  /** Applies the proposal: profile, ADR, vision and plan in one ChangeSet; the scaffold task ends READY. */
  async approve(projectId: string): Promise<InceptionViewDto> {
    this.requireProject(projectId);
    const current = this.record(projectId);
    if (!current || current.stage !== 'PROPOSAL' || current.status !== 'WAITING_USER' || !current.changeSetId)
      throw new Error('No hay una propuesta de inicio esperando tu aprobación.');
    if (current.error) throw new Error(`La propuesta está incompleta: ${current.error} Vuelve a generarla.`);
    if (!this.deps.repositoryPath(projectId))
      throw new Error(
        'Configura o inicializa el repositorio Git del proyecto antes de aprobar: la propuesta escribe la visión y el ADR en docs/.',
      );
    const changeSet = this.deps.planning.find(current.changeSetId);
    if (!changeSet) throw new Error('La propuesta de inicio ya no existe; vuelve a generarla.');
    if (changeSet.status !== 'VALIDATED')
      throw new Error(
        `La propuesta no pasó la validación: ${changeSet.validationIssues.map(issue => issue.message).join(' ') || changeSet.status}. Vuelve a generarla.`,
      );
    // The approved prototype goes to the repository first: if it cannot be saved nothing has been applied yet.
    const approved = current.ui.options.find(option => option.id === current.ui.selectedOptionId);
    if (approved?.prototypeHtml && this.deps.designFiles) {
      const root = this.deps.repositoryPath(projectId)!;
      await this.deps.designFiles.write(root, approved.prototypeHtml).catch((error: unknown) => {
        throw new Error(
          `No se pudo guardar el prototipo aprobado: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    const applied = await this.deps.planning.apply(changeSet.id);
    const scaffold = scaffoldTempId(changeSet.operations as ChangeOperation[]);
    const scaffoldTaskId = scaffold ? (applied.resolvedIds?.[scaffold] ?? null) : null;
    const done: InceptionRecord = {
      ...current,
      stage: 'APPLIED',
      status: 'DONE',
      error: null,
      scaffoldTaskId,
      updatedAt: new Date().toISOString(),
    };
    this.deps.store.save(done);
    this.deps.emit?.('graph:revision_updated', { projectId, revision: applied.revision });
    this.notify(done);
    return this.get(projectId);
  }

  /** Back to the start: stops a running call, forgets questions and answers and rejects a pending proposal. Nothing applied is undone. */
  restart(projectId: string): InceptionViewDto {
    this.requireProject(projectId);
    const current = this.record(projectId);
    if (current?.stage === 'APPLIED')
      throw new Error('El inicio ya se aplicó; los cambios al plan van por Planificar.');
    this.controllers.get(projectId)?.abort();
    if (current?.changeSetId) {
      const pending = this.deps.planning.find(current.changeSetId);
      if (pending && !['APPLIED', 'REJECTED'].includes(pending.status)) this.deps.planning.reject(pending.id);
    }
    this.deps.store.delete(projectId);
    this.deps.referenceFiles?.deleteAll(projectId);
    this.deps.emit?.('inception:updated', { projectId, stage: 'NOT_STARTED', status: 'IDLE' });
    return this.get(projectId);
  }

  /** App shutdown: aborts every running call (their processes are stopped); the record stays WORKING and reads as interrupted on the next open. */
  shutdown(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  /** Resolves when the background engine call (if any) has finished. */
  async settled(projectId: string): Promise<void> {
    await this.running.get(projectId)?.catch(() => undefined);
  }

  /** The inbox entry: what the inception needs from the user, or null when there is nothing to say. */
  activity(projectId: string): InceptionActivityDto | null {
    const view = this.get(projectId);
    if (view.stage === 'NOT_STARTED' || view.stage === 'APPLIED') return null;
    const changeSetId = view.proposal?.changeSetId ?? null,
      at = view.updatedAt ?? new Date().toISOString();
    const base = { stage: view.stage, status: view.status, changeSetId, at };
    if (view.status === 'WORKING')
      return {
        ...base,
        title:
          view.stage === 'ASK_GOALS' && !view.questions.length
            ? 'Inicio del proyecto: preparando las preguntas'
            : (view.ui.wanted && !view.ui.options.length) || view.stage === 'EXPLORE_UI'
              ? 'Inicio del proyecto: preparando el diseño'
              : 'Inicio del proyecto: preparando la propuesta',
        detail: 'El asistente está trabajando; te avisaremos al terminar.',
        needsAttention: false,
      };
    if (view.status === 'FAILED')
      return {
        ...base,
        title: 'Inicio del proyecto: falló la última llamada',
        detail: view.error ?? 'Vuelve a intentarlo.',
        needsAttention: true,
      };
    if (view.stage === 'ASK_GOALS')
      return {
        ...base,
        title: 'Inicio del proyecto: te falta responder',
        detail: `${view.questions.length} pregunta${view.questions.length === 1 ? '' : 's'} sobre el objetivo y el alcance.`,
        needsAttention: true,
      };
    if (view.stage === 'EXPLORE_UI')
      return {
        ...base,
        title: 'Inicio del proyecto: elige una dirección visual',
        detail:
          view.error ??
          `${view.ui.options.length} propuesta${view.ui.options.length === 1 ? '' : 's'} de diseño con prototipo. Pruébalas, pide ajustes y aprueba una (o salta el diseño).`,
        needsAttention: true,
      };
    return {
      ...base,
      title: 'Inicio del proyecto: te falta aprobar',
      detail:
        view.nextAction === 'SET_UP_REPOSITORY'
          ? 'Configura o inicializa el repositorio y aprueba la propuesta.'
          : view.nextAction === 'REVISE_PROPOSAL'
            ? 'La propuesta tiene problemas; revísala o vuelve a generarla.'
            : 'Revisa la visión, el stack y el plan inicial, y apruébalos.',
      needsAttention: true,
    };
  }

  private launch(
    record: InceptionRecord,
    work: (
      signal: AbortSignal,
    ) => Promise<Omit<Partial<InceptionRecord>, 'usage'> & { usage: InceptionEngineUsage | null }>,
    failedStage: InceptionRecord['stage'],
    failureStatus: InceptionRecord['status'] = 'FAILED',
  ): void {
    const controller = new AbortController();
    this.controllers.get(record.projectId)?.abort();
    this.controllers.set(record.projectId, controller);
    const task = (async () => {
      let patch: Omit<Partial<InceptionRecord>, 'usage'> & { usage: InceptionEngineUsage | null };
      try {
        patch = await work(controller.signal);
      } catch (error) {
        patch = {
          stage: failedStage,
          status: failureStatus,
          error: error instanceof Error ? error.message : String(error),
          usage: null,
        };
      }
      // A voluntary cancellation (restart, shutdown) never turns into FAILED: whoever aborted owns the state.
      if (controller.signal.aborted) return;
      // A restart while the engine worked discards its answer.
      const latest = this.deps.store.find(record.projectId);
      if (!latest || latest.createdAt !== record.createdAt || latest.status !== 'WORKING') return;
      const { usage, ...rest } = patch;
      const next: InceptionRecord = {
        ...latest,
        ...rest,
        usage: usage ? [...latest.usage, usage] : latest.usage,
        updatedAt: new Date().toISOString(),
      };
      if (!('error' in rest)) next.error = null;
      let stored = next;
      try {
        this.deps.store.save(next);
      } catch (error) {
        // The engine finished but its result could not be stored: say so instead of leaving the record WORKING for good.
        stored = {
          ...latest,
          stage: failedStage,
          status: failureStatus,
          error: `No se pudo guardar el resultado: ${error instanceof Error ? error.message : String(error)}`,
          usage: usage ? [...latest.usage, usage] : latest.usage,
          updatedAt: new Date().toISOString(),
        };
        try {
          this.deps.store.save(stored);
        } catch {
          /* the next read reports the call as interrupted */
        }
      }
      this.notify(stored);
    })().finally(() => {
      if (this.running.get(record.projectId) === task) this.running.delete(record.projectId);
      if (this.controllers.get(record.projectId) === controller) this.controllers.delete(record.projectId);
    });
    this.running.set(record.projectId, task);
  }

  private view(projectId: string, record: InceptionRecord | null): InceptionViewDto {
    const repositoryPath = this.deps.repositoryPath(projectId);
    const usage = (record?.usage ?? []).reduce(
      (total, item) => ({
        calls: total.calls + 1,
        inputTokens: total.inputTokens + item.inputTokens,
        outputTokens: total.outputTokens + item.outputTokens,
        cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens,
        cacheCreationTokens: total.cacheCreationTokens + item.cacheCreationTokens,
        costUsd: item.costUsd === null ? total.costUsd : (total.costUsd ?? 0) + item.costUsd,
      }),
      {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: null as number | null,
      },
    );
    if (!record)
      return {
        projectId,
        stage: 'NOT_STARTED',
        status: 'IDLE',
        nextAction: 'START',
        brief: '',
        questions: [],
        answers: [],
        assumptions: [],
        proposal: null,
        error: null,
        model: null,
        repositoryPath,
        usage,
        notes: [],
        scaffoldTaskId: null,
        references: [],
        ui: { wanted: false, options: [], selectedOptionId: null },
        repository: null,
        updatedAt: null,
      };
    const status: InceptionStatus = record.status;
    const proposal = record.changeSetId ? this.proposal(record.changeSetId) : null;
    const stage: InceptionStage = record.stage;
    const nextAction: InceptionNextAction =
      status === 'WORKING'
        ? 'WAIT'
        : stage === 'APPLIED'
          ? 'DONE'
          : status === 'FAILED'
            ? stage === 'ASK_GOALS' && !record.questions.length
              ? 'RETRY_QUESTIONS'
              : stage === 'ASK_GOALS' && record.ui.wanted
                ? 'RETRY_UI'
                : 'RETRY_PROPOSAL'
            : stage === 'ASK_GOALS'
              ? 'ANSWER'
              : stage === 'EXPLORE_UI'
                ? 'CHOOSE_UI'
                : !proposal || proposal.status !== 'VALIDATED' || record.error
                  ? 'REVISE_PROPOSAL'
                  : !repositoryPath
                    ? 'SET_UP_REPOSITORY'
                    : 'APPROVE';
    return {
      projectId,
      stage,
      status,
      nextAction,
      brief: record.brief,
      questions: record.questions,
      answers: record.answers,
      assumptions: record.assumptions,
      proposal,
      error: record.error,
      model: record.model,
      repositoryPath,
      usage,
      notes: record.notes ?? [],
      scaffoldTaskId: record.scaffoldTaskId ?? null,
      references: (record.references ?? []).map(({ file: _file, ...visible }) => visible),
      ui: {
        wanted: record.ui.wanted,
        selectedOptionId: record.ui.selectedOptionId,
        options: record.ui.options.map(
          ({ prototypeHtml: _html, imageFile: _file, imageMime: _mime, ...visible }) => visible,
        ),
      },
      repository: record.repository
        ? {
            scan: summarizeScan(record.repository.scan),
            inferences: record.repository.inferences,
            corrections: record.repository.corrections,
            access: accessView(record.repository),
          }
        : null,
      updatedAt: record.updatedAt,
    };
  }

  private proposal(changeSetId: string): InceptionProposalDto | null {
    const changeSet = this.deps.planning.find(changeSetId);
    if (!changeSet) return null;
    const verdict = decide(
      changeSet.operations as Array<{ type: string; [key: string]: unknown }>,
      DEFAULT_DECISION_POLICY,
      { featureTasks: new Set(), featureId: '', autoTasksSoFar: 0 },
    );
    return {
      changeSetId,
      title: changeSet.title,
      rationale: changeSet.rationale,
      status: changeSet.status,
      issues: changeSet.validationIssues.map(issue => issue.message),
      decisionReasons: verdict.reasons,
      ...summarizeFoundationPlan(changeSet.operations as ChangeOperation[]),
    };
  }

  private chooseModel(projectId: string, requested: string | undefined): string | null {
    const models = this.deps.models(projectId),
      model = typeof requested === 'string' ? requested.trim() : '';
    if (model && !models.available.includes(model))
      throw new Error(`El modelo ${model} no está disponible para planificar.`);
    return model || models.planning;
  }
  private projectInput(
    projectId: string,
    brief: string,
    props: { name: string; description?: string | null },
    references: readonly InceptionReference[] = [],
    direction?: ReturnType<ProjectInceptionService['approvedDirection']>,
    repository?: InceptionRepositoryState | null,
  ) {
    const understood = references.flatMap(item =>
      item.status === 'TRANSLATED' && item.translation
        ? [{ kind: item.kind, name: item.name, note: item.note, translation: item.translation }]
        : [],
    );
    return {
      name: props.name,
      description: props.description ?? null,
      brief,
      rootId: this.rootId(projectId),
      ...(understood.length ? { references: understood } : {}),
      ...(direction ? { direction } : {}),
      ...(repository ? { repository } : {}),
    };
  }

  /**
   * Brownfield mode: reads the configured repository (manifests, structure, styles; nothing runs). Only a repository that already has code
   * counts; what was read is stored right away, so the user sees it while the assistant works and a later failure does not lose it.
   */
  private async scanRepository(record: InceptionRecord, signal: AbortSignal): Promise<InceptionRepositoryState | null> {
    const path = this.deps.repositoryPath(record.projectId),
      scanner = this.deps.scanner;
    if (!path || !scanner) return null;
    const scan = await scanner.scan(path).catch((error: unknown) => {
      throw new Error(
        `No se pudo leer el repositorio ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!scan.hasCode) return null;
    const state: InceptionRepositoryState = { scan, inferences: [], corrections: [] };
    const latest = this.deps.store.find(record.projectId);
    if (!signal.aborted && latest && latest.createdAt === record.createdAt && latest.status === 'WORKING')
      this.deps.store.save({ ...latest, repository: state, updatedAt: new Date().toISOString() });
    return state;
  }

  /**
   * Sends the references that are not translated yet to the translator (one call for all of them) and stores what it understood right away,
   * so a later failure of the assistant does not lose it. A reference it could not read fails the step with a message naming it.
   */
  private async translateReferences(record: InceptionRecord, signal: AbortSignal): Promise<InceptionReference[]> {
    const pending = record.references.filter(item => item.status !== 'TRANSLATED');
    if (!pending.length) return record.references;
    const { translator, referenceFiles } = this.deps;
    if (!translator || !referenceFiles) throw new Error('Esta versión de la app no puede analizar referencias.');
    const out = await translator.translate({
      files: pending.map(item => ({
        id: item.id,
        kind: item.kind,
        note: item.note,
        mimeType: item.mimeType,
        path: referenceFiles.pathOf(record.projectId, item.file),
      })),
      ...this.translationModel(record.projectId),
      signal,
    });
    const byId = new Map(out.results.map(result => [result.id, result]));
    const references = record.references.map((item): InceptionReference => {
      const result = byId.get(item.id);
      if (!result) return item;
      return result.translation
        ? { ...item, status: 'TRANSLATED', error: null, translation: result.translation }
        : { ...item, status: 'FAILED', error: result.error ?? 'No se pudo analizar el archivo.', translation: null };
    });
    const latest = this.deps.store.find(record.projectId);
    if (!signal.aborted && latest && latest.createdAt === record.createdAt && latest.status === 'WORKING') {
      this.deps.store.save({
        ...latest,
        references,
        usage: out.usage ? [...latest.usage, out.usage] : latest.usage,
        updatedAt: new Date().toISOString(),
      });
    }
    const failed = references.filter(item => item.status === 'FAILED');
    if (failed.length)
      throw new Error(
        `No se pudo analizar ${failed.map(item => `«${item.name}»`).join(', ')}: ${failed[0]!.error} Vuelve a intentarlo o empieza de nuevo sin esa referencia.`,
      );
    return references;
  }
  private rootId(projectId: string): string {
    const root = this.deps.graph.listEntities(projectId).find(entity => entity.entityType === 'PROJECT_ROOT');
    if (!root) throw new Error('El proyecto no tiene nodo raíz.');
    return root.id;
  }
  /**
   * The stored record, with a call left WORKING by a closed app read as what it is: failed (or, while choosing a design, back to waiting with the reason).
   * Every action reads it through here, so what the view offers to retry is also accepted.
   */
  private record(projectId: string): InceptionRecord | null {
    const stored = this.deps.store.find(projectId);
    if (stored && stored.status === 'WORKING' && !this.running.has(projectId))
      return { ...stored, status: stored.stage === 'EXPLORE_UI' ? 'WAITING_USER' : 'FAILED', error: INTERRUPTED };
    return stored;
  }
  /** The model that translates files into text: a capable-but-cheap one (sonnet, else haiku), not the planning model. */
  private translationModel(projectId: string): { model?: string } {
    const models = this.deps.models(projectId);
    const model = ['sonnet', 'haiku'].find(alias => models.available.includes(alias)) ?? models.planning;
    return model ? { model } : {};
  }
  private requireExploring(projectId: string): InceptionRecord {
    this.requireProject(projectId);
    const current = this.record(projectId);
    if (!current || current.stage !== 'EXPLORE_UI') throw new Error('No estás eligiendo una dirección visual.');
    if (current.status === 'WORKING') throw new Error('Espera a que termine la llamada en curso.');
    return current;
  }
  private uiModel(record: InceptionRecord): { model?: string } {
    const models = this.deps.models(record.projectId);
    const model = ['sonnet', 'opus'].find(alias => models.available.includes(alias)) ?? record.model ?? models.planning;
    return model ? { model } : {};
  }
  private nextUiId(options: readonly InceptionUiOption[]): string {
    return `ui-${options.reduce((highest, item) => Math.max(highest, Number(item.id.replace(/\D/g, '')) || 0), 0) + 1}`;
  }
  private toUiOption(draft: UiOptionDraft, source: InceptionUiOption['source'], id: string): InceptionUiOption {
    return {
      id,
      title: draft.title,
      summary: draft.summary,
      navigation: draft.navigation,
      screens: draft.screens,
      designSystemNotes: draft.designSystemNotes,
      source,
      htmlBytes: Buffer.byteLength(draft.prototypeHtml),
      externalReferences: findExternalReferences(draft.prototypeHtml),
      prototypeHtml: draft.prototypeHtml,
    };
  }
  /** The design gate: 2–3 directions with their prototypes, replacing whatever was there. */
  private async exploreWork(
    record: InceptionRecord,
    props: { name: string; description?: string | null },
    signal: AbortSignal,
  ) {
    const result = await this.deps.engine.exploreUi({
      project: this.projectInput(
        record.projectId,
        record.brief,
        props,
        record.references ?? [],
        undefined,
        record.repository,
      ),
      questions: record.questions,
      answers: record.answers,
      ...this.uiModel(record),
      signal,
    });
    return {
      stage: 'EXPLORE_UI' as const,
      status: 'WAITING_USER' as const,
      ui: {
        ...record.ui,
        options: result.options.map((draft, index) => this.toUiOption(draft, 'GENERATED', `ui-${index + 1}`)),
        selectedOptionId: null,
      },
      assumptions: [...new Set([...record.assumptions, ...result.assumptions])],
      usage: result.usage,
    };
  }
  /** The proposal gate: one engine call, validated and stored as a ChangeSet awaiting the user's approval. */
  private async proposalWork(
    record: InceptionRecord,
    props: { name: string; description?: string | null },
    signal: AbortSignal,
  ) {
    const projectId = record.projectId,
      rootId = this.rootId(projectId);
    const result = await this.deps.engine.propose({
      project: this.projectInput(
        projectId,
        record.brief,
        props,
        record.references ?? [],
        this.approvedDirection(record),
        record.repository,
      ),
      questions: record.questions,
      answers: record.answers,
      ...(record.notes?.length ? { notes: record.notes } : {}),
      ...(record.model ? { model: record.model } : {}),
      signal,
    });
    const plan = buildFoundationPlan(result.draft.operations, rootId, {
      uiSpec: !!this.approvedDirection(record),
      brownfield: !!record.repository,
    });
    const changeSet = this.deps.planning.submit(
      projectId,
      {
        title: result.draft.title || 'Inicio del proyecto',
        rationale: [result.draft.rationale, ...plan.problems.map(problem => `Pendiente: ${problem}`)]
          .filter(Boolean)
          .join('\n'),
        operations: withAgentAccess(plan.operations, record.repository),
      },
      `inception:${projectId}`,
    );
    return {
      stage: 'PROPOSAL' as const,
      status: 'WAITING_USER' as const,
      assumptions: [...new Set([...record.assumptions, ...result.assumptions])],
      usage: result.usage,
      changeSetId: changeSet.id,
      error: plan.problems.length ? plan.problems.join(' ') : null,
    };
  }
  private approvedDirection(record: InceptionRecord) {
    const option = record.ui.options.find(item => item.id === record.ui.selectedOptionId);
    return option
      ? {
          title: option.title,
          summary: option.summary,
          navigation: option.navigation,
          screens: option.screens,
          designSystemNotes: option.designSystemNotes,
          source: option.source === 'IMPORTED' ? ('IMPORTED' as const) : ('GENERATED' as const),
          ...(option.source === 'IMPORTED' ? { prototypeHtml: option.prototypeHtml } : {}),
        }
      : undefined;
  }
  private requireProject(projectId: string) {
    const project = this.deps.projects.findById(projectId);
    if (!project) throw new Error('Proyecto no encontrado.');
    return project;
  }
  private notify(record: InceptionRecord): void {
    this.deps.emit?.('inception:updated', { projectId: record.projectId, stage: record.stage, status: record.status });
  }
}
