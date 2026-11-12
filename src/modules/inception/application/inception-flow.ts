import {
  type InceptionAnswerDto,
  type InceptionViewDto,
  MAX_INCEPTION_NOTE,
  type StartInceptionInput,
} from '../../../shared/contracts/inception-view.js';
import type { ChangeOperation } from '../../knowledge/index.js';
import { scaffoldTempId } from './foundation-plan.js';
import {
  type InceptionKernel,
  MAX_ANSWER,
  MAX_BRIEF,
  MAX_NOTES,
  MAX_QUESTIONS,
  chooseModel,
  notify,
  projectInput,
  findRecord,
  requireProject,
} from './inception-kernel.js';
import { view } from './inception-snapshot.js';
import { exploreWork, launch, proposalWork, scanRepository, translateReferences } from './inception-work.js';
import { abortSurvey, startSurvey } from './inception-survey.js';
import { EMPTY_UI_STATE, type InceptionRecord, type InceptionReference } from './ports/inception-port.js';
import { prepareReferences } from './reference-files.js';
import { editedRepository } from './repository-access.js';
import { normalizeInferences } from './repository-evidence.js';

export function get(k: InceptionKernel, projectId: string): InceptionViewDto {
  return view(k, projectId, findRecord(k, projectId));
}

export function start(k: InceptionKernel, projectId: string, input: StartInceptionInput): InceptionViewDto {
  const project = requireProject(k, projectId),
    current = findRecord(k, projectId);
  if (current && !(current.stage === 'ASK_GOALS' && current.status === 'FAILED' && !current.questions.length))
    throw new Error('El inicio del proyecto ya empezó. Continúa donde lo dejaste o reinícialo.');
  if (
    k.deps.graph
      .listEntities(projectId)
      .some(entity => entity.entityType === 'FEATURE' || entity.entityType === 'WORK_ITEM')
  )
    throw new Error('El proyecto ya tiene un plan; el asistente de inicio es para proyectos vacíos.');
  const brief = String(input?.brief ?? '').trim();
  if (!brief) throw new Error('Describe en pocas líneas qué quieres construir.');
  if (brief.length > MAX_BRIEF) throw new Error(`La descripción admite como mucho ${MAX_BRIEF} caracteres.`);
  const model = chooseModel(k, projectId, input?.model),
    now = new Date().toISOString();
  const references = startReferences(k, projectId, current, input);
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
  k.deps.store.save(record);
  launch(k, record, signal => askGoals(k, record, project, model, signal), 'ASK_GOALS');
  return get(k, projectId);
}

/**
 * Answers the questions and asks for the proposal; in PROPOSAL it regenerates it (the previous one is rejected).
 * `notes` (PROPOSAL only) is what the user wants changed: it is kept, with earlier ones, for every later regeneration.
 */
export function answer(
  k: InceptionKernel,
  projectId: string,
  answers: InceptionAnswerDto[],
  notes?: string | null,
  options?: {
    exploreUi?: boolean /** Brownfield: corrections of the inferences and the agent's access (each replaces the earlier one). */;
    corrections?: unknown;
    access?: unknown;
  },
): InceptionViewDto {
  const project = requireProject(k, projectId),
    current = findRecord(k, projectId);
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
  const { normalized, allNotes } = answersAndNote(current, answers, notes);
  const repository = editedRepository(current.repository, options);
  if (current.changeSetId) {
    const previous = k.deps.planning.find(current.changeSetId);
    if (previous && !['APPLIED', 'REJECTED'].includes(previous.status)) k.deps.planning.reject(previous.id);
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
  k.deps.store.save(record);
  if (exploring) launch(k, record, signal => exploreWork(k, record, project.props, signal), current.stage);
  else launch(k, record, signal => proposalWork(k, record, project.props, signal), current.stage);
  return get(k, projectId);
}

/** Applies the proposal: profile, ADR, vision and plan in one ChangeSet; the scaffold task ends READY. */
export async function approve(k: InceptionKernel, projectId: string): Promise<InceptionViewDto> {
  requireProject(k, projectId);
  const current = findRecord(k, projectId);
  if (!current || current.stage !== 'PROPOSAL' || current.status !== 'WAITING_USER' || !current.changeSetId)
    throw new Error('No hay una propuesta de inicio esperando tu aprobación.');
  if (current.error) throw new Error(`La propuesta está incompleta: ${current.error} Vuelve a generarla.`);
  if (!k.deps.repositoryPath(projectId))
    throw new Error(
      'Configura o inicializa el repositorio Git del proyecto antes de aprobar: la propuesta escribe la visión y el ADR en docs/.',
    );
  const changeSet = k.deps.planning.find(current.changeSetId);
  if (!changeSet) throw new Error('La propuesta de inicio ya no existe; vuelve a generarla.');
  if (changeSet.status !== 'VALIDATED')
    throw new Error(
      `La propuesta no pasó la validación: ${changeSet.validationIssues.map(issue => issue.message).join(' ') || changeSet.status}. Vuelve a generarla.`,
    );
  // The approved prototype goes to the repository first: if it cannot be saved nothing has been applied yet.
  const approved = current.ui.options.find(option => option.id === current.ui.selectedOptionId);
  if (approved?.prototypeHtml && k.deps.designFiles) {
    const root = k.deps.repositoryPath(projectId)!;
    await k.deps.designFiles.write(root, approved.prototypeHtml).catch((error: unknown) => {
      throw new Error(
        `No se pudo guardar el prototipo aprobado: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  const applied = await k.deps.planning.apply(changeSet.id);
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
  k.deps.store.save(done);
  k.deps.emit?.('graph:revision_updated', { projectId, revision: applied.revision });
  notify(k, done);
  return get(k, projectId);
}

/** Back to the start: stops a running call, forgets questions and answers and rejects a pending proposal. Nothing applied is undone. */
export function restart(k: InceptionKernel, projectId: string): InceptionViewDto {
  requireProject(k, projectId);
  const current = findRecord(k, projectId);
  if (current?.stage === 'APPLIED') throw new Error('El inicio ya se aplicó; los cambios al plan van por Planificar.');
  k.controllers.get(projectId)?.abort();
  abortSurvey(k, projectId);
  if (current?.changeSetId) {
    const pending = k.deps.planning.find(current.changeSetId);
    if (pending && !['APPLIED', 'REJECTED'].includes(pending.status)) k.deps.planning.reject(pending.id);
  }
  k.deps.store.delete(projectId);
  k.deps.referenceFiles?.deleteAll(projectId);
  k.deps.emit?.('inception:updated', { projectId, stage: 'NOT_STARTED', status: 'IDLE' });
  return get(k, projectId);
}

/** App shutdown: aborts every running call (their processes are stopped); the record stays WORKING and reads as interrupted on the next open. */
export function shutdown(k: InceptionKernel): void {
  for (const controller of k.controllers.values()) controller.abort();
  for (const projectId of [...k.surveys.keys()]) abortSurvey(k, projectId);
}

/** Resolves when the background engine call (if any) has finished. */
export async function settled(k: InceptionKernel, projectId: string): Promise<void> {
  await k.running.get(projectId)?.catch(() => undefined);
}

/** New references replace the stored ones; on a retry after a failure none are sent and the stored ones (and what was already translated) are reused. */
function startReferences(
  k: InceptionKernel,
  projectId: string,
  current: InceptionRecord | null,
  input: StartInceptionInput,
): InceptionReference[] {
  if (!Array.isArray(input?.references) || !input.references.length) return current?.references ?? [];
  const prepared = prepareReferences(input.references);
  if (!k.deps.referenceFiles || !k.deps.translator)
    throw new Error('Esta versión de la app no puede analizar referencias.');
  k.deps.referenceFiles.deleteAll(projectId);
  for (const item of prepared) k.deps.referenceFiles.save(projectId, item.file, item.content);
  return prepared.map(
    ({ content: _content, ...rest }): InceptionReference => ({
      ...rest,
      status: 'PENDING',
      error: null,
      translation: null,
    }),
  );
}

/** First engine call: reads the repository (brownfield), translates the references and asks the questions. */
async function askGoals(
  k: InceptionKernel,
  record: InceptionRecord,
  project: ReturnType<typeof requireProject>,
  model: string | null,
  signal: AbortSignal,
) {
  const projectId = record.projectId,
    brief = record.brief;
  // Brownfield: a repository that already has code is read first (nothing runs), and everything after works from that evidence.
  const repository = await scanRepository(k, record, signal);
  // Plan REP, R3: the survey reads the code in the background while the user answers; the proposal waits for it.
  if (repository && !signal.aborted) startSurvey(k, { ...record, repository });
  const understood = await translateReferences(k, record, signal);
  const result = await k.deps.engine.askGoals({
    project: projectInput(k, projectId, brief, project.props, understood, undefined, repository),
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
    stage: 'ASK_GOALS' as const,
    status: 'WAITING_USER' as const,
    questions,
    assumptions: result.assumptions,
    repository: repository
      ? { ...repository, inferences: normalizeInferences(result.inferences, repository.scan) }
      : null,
    usage: result.usage,
  };
}

/** The answers checked against the questions (earlier ones kept) and the notes with the new change request, if any. */
function answersAndNote(current: InceptionRecord, answers: InceptionAnswerDto[], notes: string | null | undefined) {
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
  const normalized = current.questions.map(question => ({
    questionId: question.id,
    answer: given.get(question.id) ?? current.answers.find(answer => answer.questionId === question.id)?.answer ?? '',
  }));
  return { normalized, allNotes };
}
