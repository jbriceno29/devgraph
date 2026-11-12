import type { InceptionProposalDto } from '../../../shared/contracts/inception-view.js';
import { findExternalReferences } from '../../../shared/prototype-safety.js';
import { DEFAULT_DECISION_POLICY, decide } from '../../autopilot/index.js';
import type { ChangeOperation, ChangeSet, KnowledgeGraphRepositoryPort } from '../../knowledge/index.js';
import type { ChangeSetDraft } from '../../planning/index.js';
import type { ProjectRepositoryPort, RepositoryScannerPort } from '../../projects/index.js';
import { summarizeFoundationPlan } from './foundation-plan.js';
import type {
  DesignPrototypeWriterPort,
  InceptionEnginePort,
  InceptionRecord,
  InceptionReference,
  InceptionReferenceFilesPort,
  InceptionRepositoryPort,
  InceptionRepositoryState,
  InceptionUiOption,
  ReferenceTranslatorPort,
  UiOptionDraft,
} from './ports/inception-port.js';

/** The ChangeSet flow the inception reuses (validation, review and application are the same as any other proposal). */
export interface InceptionPlanningPort {
  submit(projectId: string, draft: ChangeSetDraft, originRefId: string): ChangeSet;
  find(changeSetId: string): ChangeSet | null;
  /** `resolvedIds` maps each tempId to the graph id it got (the scaffold task's id is kept from it). */
  apply(changeSetId: string): Promise<{ revision: number; resolvedIds?: Record<string, string> }>;
  reject(changeSetId: string): void;
}
/** Saves the approved prototype in the repository; returns its relative path. */
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
  baselineOf?(projectId: string): import('./ports/inception-port.js').PlanBaseline | null;
  emit?(channel: 'inception:updated' | 'graph:revision_updated', payload: unknown): void;
}

export const MAX_QUESTIONS = 5,
  MAX_BRIEF = 4000,
  MAX_ANSWER = 1000,
  MAX_NOTES = 5;
export const INTERRUPTED = 'La llamada se interrumpió (la app se cerró). Vuelve a intentarlo.';
export const HTML_START = /<\s*(?:!doctype|html|body|head|div|main|section|header)\b/i;
/** What the engine is told when the imported thing is React code: convert it, do not redesign it. */
export const CONVERT_REACT_NOTE =
  'Lo que hay en "prototypeHtml" NO es HTML: es el código de un componente React (JSX). Conviértelo en UN documento HTML autocontenido, sin React ni ninguna dependencia, con el mismo diseño y el mismo comportamiento: reescribe la interactividad con JavaScript sencillo y mantén el estado en memoria. Si no tienes un título mejor, usa el nombre del componente.';
/** What the engine is told when a direction comes from a picture and has no prototype yet. */
export const IMAGE_TO_PROTOTYPE_NOTE =
  'Esta dirección viene de la imagen de un diseño ya hecho y todavía no tiene prototipo (no hay HTML). Crea un prototipo HTML interactivo que la reproduzca con fidelidad a partir de su descripción (paleta, tipografía, composición, pantallas y estados), y aplica además estos cambios:';
export const imagePage = (mime: string, bytes: Buffer) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>html,body{margin:0;background:#f4f4f5}img{display:block;max-width:100%;height:auto;margin:0 auto}</style></head><body><img alt="Imagen del diseño importado" src="data:${mime};base64,${bytes.toString('base64')}"></body></html>`;
export const displayName = (value: unknown) =>
  String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);

/** What every part of the inception shares: its ports and the engine calls this process runs, by project (A3). */
export interface InceptionKernel {
  readonly deps: ProjectInceptionDependencies;
  readonly running: Map<string, Promise<void>>;
  readonly controllers: Map<string, AbortController>;
}

export function proposalView(k: InceptionKernel, changeSetId: string): InceptionProposalDto | null {
  const changeSet = k.deps.planning.find(changeSetId);
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

export function chooseModel(k: InceptionKernel, projectId: string, requested: string | undefined): string | null {
  const models = k.deps.models(projectId),
    model = typeof requested === 'string' ? requested.trim() : '';
  if (model && !models.available.includes(model))
    throw new Error(`El modelo ${model} no está disponible para planificar.`);
  return model || models.planning;
}

export function projectInput(
  k: InceptionKernel,
  projectId: string,
  brief: string,
  props: { name: string; description?: string | null },
  references: readonly InceptionReference[] = [],
  direction?: ReturnType<typeof approvedDirection>,
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
    rootId: projectRootId(k, projectId),
    ...(understood.length ? { references: understood } : {}),
    ...(direction ? { direction } : {}),
    ...(repository ? { repository } : {}),
  };
}

export function projectRootId(k: InceptionKernel, projectId: string): string {
  const root = k.deps.graph.listEntities(projectId).find(entity => entity.entityType === 'PROJECT_ROOT');
  if (!root) throw new Error('El proyecto no tiene nodo raíz.');
  return root.id;
}

/**
 * The stored record, with a call left WORKING by a closed app read as what it is: failed (or, while choosing a design, back to waiting with the reason).
 * Every action reads it through here, so what the view offers to retry is also accepted.
 */
export function findRecord(k: InceptionKernel, projectId: string): InceptionRecord | null {
  const stored = k.deps.store.find(projectId);
  if (stored && stored.status === 'WORKING' && !k.running.has(projectId))
    return { ...stored, status: stored.stage === 'EXPLORE_UI' ? 'WAITING_USER' : 'FAILED', error: INTERRUPTED };
  return stored;
}

/** The model that translates files into text: a capable-but-cheap one (sonnet, else haiku), not the planning model. */
export function translationModel(k: InceptionKernel, projectId: string): { model?: string } {
  const models = k.deps.models(projectId);
  const model = ['sonnet', 'haiku'].find(alias => models.available.includes(alias)) ?? models.planning;
  return model ? { model } : {};
}

export function requireExploring(k: InceptionKernel, projectId: string): InceptionRecord {
  requireProject(k, projectId);
  const current = findRecord(k, projectId);
  if (!current || current.stage !== 'EXPLORE_UI') throw new Error('No estás eligiendo una dirección visual.');
  if (current.status === 'WORKING') throw new Error('Espera a que termine la llamada en curso.');
  return current;
}

export function uiModel(k: InceptionKernel, record: InceptionRecord): { model?: string } {
  const models = k.deps.models(record.projectId);
  const model = ['sonnet', 'opus'].find(alias => models.available.includes(alias)) ?? record.model ?? models.planning;
  return model ? { model } : {};
}

export function nextUiId(k: InceptionKernel, options: readonly InceptionUiOption[]): string {
  return `ui-${options.reduce((highest, item) => Math.max(highest, Number(item.id.replace(/\D/g, '')) || 0), 0) + 1}`;
}

export function toUiOption(
  k: InceptionKernel,
  draft: UiOptionDraft,
  source: InceptionUiOption['source'],
  id: string,
): InceptionUiOption {
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

export function approvedDirection(k: InceptionKernel, record: InceptionRecord) {
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

export function requireProject(k: InceptionKernel, projectId: string) {
  const project = k.deps.projects.findById(projectId);
  if (!project) throw new Error('Proyecto no encontrado.');
  return project;
}

export function notify(k: InceptionKernel, record: InceptionRecord): void {
  k.deps.emit?.('inception:updated', { projectId: record.projectId, stage: record.stage, status: record.status });
}
