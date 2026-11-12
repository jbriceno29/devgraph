import { buildFoundationPlan } from './foundation-plan.js';
import {
  type InceptionKernel,
  approvedDirection,
  notify,
  projectInput,
  projectRootId,
  toUiOption,
  translationModel,
  uiModel,
} from './inception-kernel.js';
import type {
  InceptionEngineUsage,
  InceptionRecord,
  InceptionReference,
  InceptionRepositoryState,
} from './ports/inception-port.js';
import { withAgentAccess } from './repository-access.js';
import { awaitSurvey } from './inception-survey.js';
import { surveyOperations, withoutMapCollisions } from './survey-plan.js';

export function launch(
  k: InceptionKernel,
  record: InceptionRecord,
  work: (
    signal: AbortSignal,
  ) => Promise<Omit<Partial<InceptionRecord>, 'usage'> & { usage: InceptionEngineUsage | null }>,
  failedStage: InceptionRecord['stage'],
  failureStatus: InceptionRecord['status'] = 'FAILED',
): void {
  const controller = new AbortController();
  k.controllers.get(record.projectId)?.abort();
  k.controllers.set(record.projectId, controller);
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
    const latest = k.deps.store.find(record.projectId);
    if (!latest || latest.createdAt !== record.createdAt || latest.status !== 'WORKING') return;
    notify(k, storeResult(k, latest, patch, failedStage, failureStatus));
  })().finally(() => {
    if (k.running.get(record.projectId) === task) k.running.delete(record.projectId);
    if (k.controllers.get(record.projectId) === controller) k.controllers.delete(record.projectId);
  });
  k.running.set(record.projectId, task);
}

/**
 * Brownfield mode: reads the configured repository (manifests, structure, styles; nothing runs). Only a repository that already has code
 * counts; what was read is stored right away, so the user sees it while the assistant works and a later failure does not lose it.
 */
export async function scanRepository(
  k: InceptionKernel,
  record: InceptionRecord,
  signal: AbortSignal,
): Promise<InceptionRepositoryState | null> {
  const path = k.deps.repositoryPath(record.projectId),
    scanner = k.deps.scanner;
  if (!path || !scanner) return null;
  const scan = await scanner.scan(path).catch((error: unknown) => {
    throw new Error(
      `No se pudo leer el repositorio ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!scan.hasCode) return null;
  const state: InceptionRepositoryState = { scan, inferences: [], corrections: [] };
  const latest = k.deps.store.find(record.projectId);
  if (!signal.aborted && latest && latest.createdAt === record.createdAt && latest.status === 'WORKING')
    k.deps.store.save({ ...latest, repository: state, updatedAt: new Date().toISOString() });
  return state;
}

/**
 * Sends the references that are not translated yet to the translator (one call for all of them) and stores what it understood right away,
 * so a later failure of the assistant does not lose it. A reference it could not read fails the step with a message naming it.
 */
export async function translateReferences(
  k: InceptionKernel,
  record: InceptionRecord,
  signal: AbortSignal,
): Promise<InceptionReference[]> {
  const pending = record.references.filter(item => item.status !== 'TRANSLATED');
  if (!pending.length) return record.references;
  const { translator, referenceFiles } = k.deps;
  if (!translator || !referenceFiles) throw new Error('Esta versión de la app no puede analizar referencias.');
  const out = await translator.translate({
    files: pending.map(item => ({
      id: item.id,
      kind: item.kind,
      note: item.note,
      mimeType: item.mimeType,
      path: referenceFiles.pathOf(record.projectId, item.file),
    })),
    ...translationModel(k, record.projectId),
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
  const latest = k.deps.store.find(record.projectId);
  if (!signal.aborted && latest && latest.createdAt === record.createdAt && latest.status === 'WORKING') {
    k.deps.store.save({
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

/** The design gate: 2–3 directions with their prototypes, replacing whatever was there. */
export async function exploreWork(
  k: InceptionKernel,
  record: InceptionRecord,
  props: { name: string; description?: string | null },
  signal: AbortSignal,
) {
  const result = await k.deps.engine.exploreUi({
    project: projectInput(
      k,
      record.projectId,
      record.brief,
      props,
      record.references ?? [],
      undefined,
      record.repository,
    ),
    questions: record.questions,
    answers: record.answers,
    ...uiModel(k, record),
    signal,
  });
  return {
    stage: 'EXPLORE_UI' as const,
    status: 'WAITING_USER' as const,
    ui: {
      ...record.ui,
      options: result.options.map((draft, index) => toUiOption(k, draft, 'GENERATED', `ui-${index + 1}`)),
      selectedOptionId: null,
    },
    assumptions: [...new Set([...record.assumptions, ...result.assumptions])],
    usage: result.usage,
  };
}

/** The proposal gate: one engine call, validated and stored as a ChangeSet awaiting the user's approval. */
export async function proposalWork(
  k: InceptionKernel,
  record: InceptionRecord,
  props: { name: string; description?: string | null },
  signal: AbortSignal,
) {
  const projectId = record.projectId,
    rootId = projectRootId(k, projectId);
  // Plan REP, R3: the proposal waits for the map of what exists and hangs the new work on it.
  const survey = await awaitSurvey(k, record, signal);
  const repository = record.repository && survey ? { ...record.repository, survey } : record.repository;
  const result = await k.deps.engine.propose({
    project: projectInput(
      k,
      projectId,
      record.brief,
      props,
      record.references ?? [],
      approvedDirection(k, record),
      repository,
    ),
    questions: record.questions,
    answers: record.answers,
    ...(record.notes?.length ? { notes: record.notes } : {}),
    ...(record.model ? { model: record.model } : {}),
    signal,
  });
  const map = survey?.survey ? surveyOperations(survey.survey, rootId) : [];
  const plan = buildFoundationPlan(withoutMapCollisions(result.draft.operations), rootId, {
    uiSpec: !!approvedDirection(k, record),
    brownfield: !!record.repository,
    mapped: map.length > 0,
  });
  const changeSet = k.deps.planning.submit(
    projectId,
    {
      title: result.draft.title || 'Inicio del proyecto',
      rationale: [result.draft.rationale, ...plan.problems.map(problem => `Pendiente: ${problem}`)]
        .filter(Boolean)
        .join('\n'),
      operations: withAgentAccess([...plan.operations, ...map], record.repository, k.deps.baselineOf?.(projectId)),
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

type Patch = Omit<Partial<InceptionRecord>, 'usage'> & { usage: InceptionEngineUsage | null };

/** Stores what the engine call produced; when that fails, the record says so instead of staying WORKING for good. */
function storeResult(
  k: InceptionKernel,
  latest: InceptionRecord,
  patch: Patch,
  failedStage: InceptionRecord['stage'],
  failureStatus: InceptionRecord['status'],
): InceptionRecord {
  const { usage, ...rest } = patch;
  const next: InceptionRecord = {
    ...latest,
    ...rest,
    usage: usage ? [...latest.usage, usage] : latest.usage,
    updatedAt: new Date().toISOString(),
  };
  // The survey (plan REP, R3) runs on its own: a gate's result never overwrites its progress.
  if (rest.repository && latest.repository?.survey)
    next.repository = { ...rest.repository, survey: latest.repository.survey };
  if (!('error' in rest)) next.error = null;
  let stored = next;
  try {
    k.deps.store.save(next);
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
      k.deps.store.save(stored);
    } catch {
      /* the next read reports the call as interrupted */
    }
  }
  return stored;
}
