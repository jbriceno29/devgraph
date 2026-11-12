import type { RepositorySurveyStateDto } from '../../../shared/contracts/repository-survey.js';
import { type InceptionKernel, notify } from './inception-kernel.js';
import type { InceptionRecord } from './ports/inception-port.js';
import { normalizeSurvey } from './repository-survey.js';

export const SURVEY_INTERRUPTED = 'La lectura del código se interrumpió (la app se cerró).';

/** The survey model: the plan asks for haiku (cheap, it only reads); otherwise the cheapest the provider has. */
function surveyModel(k: InceptionKernel, projectId: string): string | undefined {
  const models = k.deps.models(projectId);
  return ['haiku', 'sonnet'].find(alias => models.available.includes(alias)) ?? models.planning ?? undefined;
}

/** Saves the survey state on the latest record of the same inception (a restart in between discards it). */
function store(k: InceptionKernel, record: InceptionRecord, survey: RepositorySurveyStateDto, signal: AbortSignal) {
  if (signal.aborted) return;
  const latest = k.deps.store.find(record.projectId);
  if (!latest || latest.createdAt !== record.createdAt || !latest.repository) return;
  k.deps.store.save({ ...latest, repository: { ...latest.repository, survey }, updatedAt: new Date().toISOString() });
  notify(k, { ...latest, repository: { ...latest.repository, survey } });
}

/**
 * Plan REP, R3: starts the read-only survey in the background (it runs while the user answers the questions) and
 * stores its progress on the record, so the view shows it. Without a surveyor, or a repository with code, it does nothing.
 */
export function startSurvey(k: InceptionKernel, record: InceptionRecord): void {
  const surveyor = k.deps.surveyor,
    repository = record.repository;
  if (!surveyor || !repository || k.surveys.has(record.projectId)) return;
  const controller = new AbortController(),
    startedAt = new Date().toISOString();
  store(k, record, { status: 'RUNNING', survey: null, error: null, startedAt, finishedAt: null }, controller.signal);
  const model = surveyModel(k, record.projectId);
  const promise = surveyor
    .survey({
      projectId: record.projectId,
      scan: repository.scan,
      ...(model ? { model } : {}),
      signal: controller.signal,
    })
    .then(
      (out): RepositorySurveyStateDto => {
        const latest = controller.signal.aborted ? null : k.deps.store.find(record.projectId);
        if (out.usage && latest && latest.createdAt === record.createdAt)
          k.deps.store.save({ ...latest, usage: [...latest.usage, out.usage] });
        const survey = normalizeSurvey(out.raw, out.tracked, { ref: out.ref, commit: out.commit });
        return { status: 'DONE', survey, error: null, startedAt, finishedAt: new Date().toISOString() };
      },
      (error: unknown): RepositorySurveyStateDto => ({
        status: 'FAILED',
        survey: null,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    )
    .then(state => {
      try {
        store(k, record, state, controller.signal);
      } catch {
        /* the workspace closed meanwhile: the next open reads the survey as interrupted */
      }
      return state;
    })
    .finally(() => {
      if (k.surveys.get(record.projectId)?.controller === controller) k.surveys.delete(record.projectId);
    });
  k.surveys.set(record.projectId, { promise, controller });
}

/**
 * The map the proposal builds on: waits for a running survey; one left RUNNING by a closed app runs again. A failed
 * survey does not block the proposal (it is planned without the map, as before R3, and the view shows the error).
 */
export async function awaitSurvey(k: InceptionKernel, record: InceptionRecord, signal: AbortSignal) {
  const latest = k.deps.store.find(record.projectId) ?? record;
  const state = latest.repository?.survey;
  if (!latest.repository || !k.deps.surveyor) return null;
  if (!k.surveys.has(record.projectId) && (!state || state.status === 'RUNNING')) startSurvey(k, latest);
  const running = k.surveys.get(record.projectId);
  const settled = running
    ? await new Promise<RepositorySurveyStateDto>((resolve, reject) => {
        const abort = () => reject(new Error('Llamada al motor cancelada.'));
        signal.addEventListener('abort', abort, { once: true });
        running.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      })
    : state;
  return settled?.status === 'DONE' && settled.survey ? settled : null;
}

/** Restart or shutdown: stops the survey (its process is stopped and its result discarded). */
export function abortSurvey(k: InceptionKernel, projectId: string): void {
  k.surveys.get(projectId)?.controller.abort();
  k.surveys.delete(projectId);
}
