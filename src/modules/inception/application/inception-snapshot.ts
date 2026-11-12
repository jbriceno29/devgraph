import type {
  InceptionActivityDto,
  InceptionNextAction,
  InceptionProposalDto,
  InceptionStage,
  InceptionStatus,
  InceptionViewDto,
} from '../../../shared/contracts/inception-view.js';
import { summarizeScan } from '../../../shared/contracts/repository-scan.js';
import { get } from './inception-flow.js';
import { type InceptionKernel, proposalView } from './inception-kernel.js';
import type { InceptionRecord } from './ports/inception-port.js';
import { accessView } from './repository-access.js';
import { SURVEY_INTERRUPTED } from './inception-survey.js';

/** Plan REP, R3: a survey left RUNNING by a closed app reads as interrupted; preparing the proposal runs it again. */
function surveyView(k: InceptionKernel, record: InceptionRecord) {
  const survey = record.repository?.survey ?? null;
  if (survey?.status !== 'RUNNING' || k.surveys.has(record.projectId)) return survey;
  return { ...survey, status: 'FAILED' as const, error: `${SURVEY_INTERRUPTED} Se repetirá al preparar la propuesta.` };
}

export function view(k: InceptionKernel, projectId: string, record: InceptionRecord | null): InceptionViewDto {
  const repositoryPath = k.deps.repositoryPath(projectId);
  const usage = totalUsage(record);
  if (!record) return { ...notStarted(projectId, repositoryPath), usage };
  const status: InceptionStatus = record.status;
  const proposal = record.changeSetId ? proposalView(k, record.changeSetId) : null;
  const stage: InceptionStage = record.stage;
  const nextAction = nextActionOf(record, proposal, repositoryPath);
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
          survey: surveyView(k, record),
        }
      : null,
    updatedAt: record.updatedAt,
  };
}

/** The inbox entry: what the inception needs from the user, or null when there is nothing to say. */
export function activity(k: InceptionKernel, projectId: string): InceptionActivityDto | null {
  const view = get(k, projectId);
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

/** Tokens and cost of every engine call of the inception. */
function totalUsage(record: InceptionRecord | null) {
  return (record?.usage ?? []).reduce(
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
}

/** What the user can do next, from the stage, the status and the proposal. */
function nextActionOf(
  record: InceptionRecord,
  proposal: InceptionProposalDto | null,
  repositoryPath: string | null,
): InceptionNextAction {
  const status: InceptionStatus = record.status,
    stage: InceptionStage = record.stage;
  return status === 'WORKING'
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
}

function notStarted(projectId: string, repositoryPath: string | null): Omit<InceptionViewDto, 'usage'> {
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
    notes: [],
    scaffoldTaskId: null,
    references: [],
    ui: { wanted: false, options: [], selectedOptionId: null },
    repository: null,
    updatedAt: null,
  };
}
