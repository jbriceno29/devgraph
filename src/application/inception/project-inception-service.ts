import type { ChangeSet, ChangeOperation } from '../../domain/knowledge/change-set.js';
import { DEFAULT_DECISION_POLICY, decide } from '../../domain/autonomy/decision-policy.js';
import type { ProjectRepositoryPort } from '../ports/project-repository-port.js';
import type { KnowledgeGraphRepositoryPort } from '../ports/knowledge-graph-repository-port.js';
import type { ChangeSetDraft } from '../ports/change-set-planning-port.js';
import type { InceptionEnginePort, InceptionEngineUsage, InceptionRecord, InceptionReference, InceptionReferenceFilesPort, InceptionRepositoryPort, ReferenceTranslatorPort } from '../ports/inception-port.js';
import { prepareReferences } from './reference-files.js';
import { MAX_INCEPTION_NOTE, type InceptionActivityDto, type InceptionAnswerDto, type InceptionNextAction, type InceptionProposalDto, type InceptionStage, type InceptionStatus, type InceptionViewDto, type StartInceptionInput } from '../../shared/contracts/inception-view.js';
import { buildFoundationPlan, scaffoldTempId, summarizeFoundationPlan } from './foundation-plan.js';

/** The ChangeSet flow the inception reuses (validation, review and application are the same as any other proposal). */
export interface InceptionPlanningPort {
  submit(projectId: string, draft: ChangeSetDraft, originRefId: string): ChangeSet;
  find(changeSetId: string): ChangeSet | null;
  /** `resolvedIds` maps each tempId to the graph id it got (the scaffold task's id is kept from it). */
  apply(changeSetId: string): Promise<{ revision: number; resolvedIds?: Record<string, string> }>;
  reject(changeSetId: string): void;
}
export interface ProjectInceptionDependencies {
  projects: ProjectRepositoryPort; graph: KnowledgeGraphRepositoryPort; store: InceptionRepositoryPort; engine: InceptionEnginePort; planning: InceptionPlanningPort;
  repositoryPath(projectId: string): string | null;
  /** Planning model of the wired provider (decision 6: opus) and the aliases it accepts. */
  models(projectId: string): { planning: string | null; available: string[] };
  /** Translates attached references to text, and where they are stored. Without them the assistant refuses references (it cannot read files itself). */
  translator?: ReferenceTranslatorPort;
  referenceFiles?: InceptionReferenceFilesPort;
  emit?(channel: 'inception:updated' | 'graph:revision_updated', payload: unknown): void;
}

const MAX_QUESTIONS = 5, MAX_BRIEF = 4000, MAX_ANSWER = 1000, MAX_NOTES = 5;

/**
 * Project inception (MVP with two gates): ASK_GOALS → PROPOSAL (waiting for approval) → APPLIED. Engine calls run in
 * the background (the IPC call returns at once with status WORKING; `inception:updated` reports the end) and each one
 * is independent: brief, questions, answers and the proposal live in the workspace, never in an engine session.
 * The proposal is a normal ChangeSet: validated, classified by the decision policy (PROJECT_FOUNDATION always asks)
 * and applied only when the user approves it. A restart or the app shutdown aborts the running call (its process is stopped).
 */
export class ProjectInceptionService {
  private readonly running = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  constructor(private readonly deps: ProjectInceptionDependencies) {}

  get(projectId: string): InceptionViewDto { return this.view(projectId, this.record(projectId)); }

  start(projectId: string, input: StartInceptionInput): InceptionViewDto {
    const project = this.requireProject(projectId), current = this.record(projectId);
    if (current && !(current.stage === 'ASK_GOALS' && current.status === 'FAILED' && !current.questions.length)) throw new Error('El inicio del proyecto ya empezó. Continúa donde lo dejaste o reinícialo.');
    if (this.deps.graph.listEntities(projectId).some(entity => entity.entityType === 'FEATURE' || entity.entityType === 'WORK_ITEM')) throw new Error('El proyecto ya tiene un plan; el asistente de inicio es para proyectos vacíos.');
    const brief = String(input?.brief ?? '').trim();
    if (!brief) throw new Error('Describe en pocas líneas qué quieres construir.');
    if (brief.length > MAX_BRIEF) throw new Error(`La descripción admite como mucho ${MAX_BRIEF} caracteres.`);
    const model = this.chooseModel(projectId, input?.model), now = new Date().toISOString();
    // New references replace the stored ones; on a retry after a failure none are sent and the stored ones (and what was already translated) are reused.
    let references: InceptionReference[] = current?.references ?? [];
    if (Array.isArray(input?.references) && input.references.length) {
      const prepared = prepareReferences(input.references);
      if (!this.deps.referenceFiles || !this.deps.translator) throw new Error('Esta versión de la app no puede analizar referencias.');
      this.deps.referenceFiles.deleteAll(projectId);
      for (const item of prepared) this.deps.referenceFiles.save(projectId, item.file, item.content);
      references = prepared.map(({ content: _content, ...rest }): InceptionReference => ({ ...rest, status: 'PENDING', error: null, translation: null }));
    }
    const record: InceptionRecord = { projectId, stage: 'ASK_GOALS', status: 'WORKING', brief, questions: [], answers: [], assumptions: [], changeSetId: null, model, usage: current?.usage ?? [], error: null, notes: [], scaffoldTaskId: null, references, createdAt: current?.createdAt ?? now, updatedAt: now };
    this.deps.store.save(record);
    this.launch(record, async signal => {
      const understood = await this.translateReferences(record, signal);
      const result = await this.deps.engine.askGoals({ project: this.projectInput(projectId, brief, project.props, understood), ...(model ? { model } : {}), signal });
      const questions = result.questions.slice(0, MAX_QUESTIONS).map((question, index) => ({ ...question, id: question.id?.trim() || `q${index + 1}`, options: question.options.slice(0, 6), default: question.default && question.options.includes(question.default) ? question.default : null }));
      return { stage: 'ASK_GOALS', status: 'WAITING_USER', questions, assumptions: result.assumptions, usage: result.usage };
    }, 'ASK_GOALS');
    return this.get(projectId);
  }

  /**
   * Answers the questions and asks for the proposal; in PROPOSAL it regenerates it (the previous one is rejected).
   * `notes` (PROPOSAL only) is what the user wants changed: it is kept, with earlier ones, for every later regeneration.
   */
  answer(projectId: string, answers: InceptionAnswerDto[], notes?: string | null): InceptionViewDto {
    const project = this.requireProject(projectId), current = this.record(projectId);
    if (!current || current.status === 'WORKING' || current.stage === 'APPLIED' || current.status === 'DONE') throw new Error(!current ? 'Empieza primero el inicio del proyecto.' : current.status === 'WORKING' ? 'Espera a que termine la llamada en curso.' : 'El inicio del proyecto ya se aplicó.');
    if (current.stage === 'ASK_GOALS' && current.status === 'FAILED' && !current.questions.length) throw new Error('Las preguntas no se generaron; vuelve a empezar.');
    const known = new Map(current.questions.map(question => [question.id, question]));
    const given = new Map<string, string>();
    for (const item of Array.isArray(answers) ? answers : []) {
      const id = String(item?.questionId ?? '');
      if (!known.has(id)) throw new Error(`La respuesta no corresponde a ninguna pregunta: ${id || '(vacía)'}.`);
      const text = String(item?.answer ?? '').trim();
      if (text.length > MAX_ANSWER) throw new Error(`Cada respuesta admite como mucho ${MAX_ANSWER} caracteres.`);
      given.set(id, text);
    }
    const note = typeof notes === 'string' ? notes.trim() : notes === undefined || notes === null ? '' : String(notes).trim();
    if (note.length > MAX_INCEPTION_NOTE) throw new Error(`Lo que quieres cambiar admite como mucho ${MAX_INCEPTION_NOTE} caracteres.`);
    if (note && current.stage !== 'PROPOSAL') throw new Error('Los cambios se piden sobre una propuesta ya preparada; responde primero las preguntas.');
    const allNotes = note ? [...(current.notes ?? []), note].slice(-MAX_NOTES) : current.notes ?? [];
    const normalized = current.questions.map(question => ({ questionId: question.id, answer: given.get(question.id) ?? current.answers.find(answer => answer.questionId === question.id)?.answer ?? '' }));
    if (current.changeSetId) { const previous = this.deps.planning.find(current.changeSetId); if (previous && !['APPLIED', 'REJECTED'].includes(previous.status)) this.deps.planning.reject(previous.id); }
    const record: InceptionRecord = { ...current, status: 'WORKING', answers: normalized, notes: allNotes, changeSetId: null, error: null, updatedAt: new Date().toISOString() };
    this.deps.store.save(record);
    const rootId = this.rootId(projectId);
    this.launch(record, async signal => {
      const result = await this.deps.engine.propose({ project: this.projectInput(projectId, record.brief, project.props, record.references ?? []), questions: record.questions, answers: normalized, ...(allNotes.length ? { notes: allNotes } : {}), ...(record.model ? { model: record.model } : {}), signal });
      const plan = buildFoundationPlan(result.draft.operations, rootId);
      const changeSet = this.deps.planning.submit(projectId, { title: result.draft.title || 'Inicio del proyecto', rationale: [result.draft.rationale, ...plan.problems.map(problem => `Pendiente: ${problem}`)].filter(Boolean).join('\n'), operations: plan.operations }, `inception:${projectId}`);
      return { stage: 'PROPOSAL', status: 'WAITING_USER', assumptions: [...new Set([...record.assumptions, ...result.assumptions])], usage: result.usage, changeSetId: changeSet.id, error: plan.problems.length ? plan.problems.join(' ') : null };
    }, current.stage);
    return this.get(projectId);
  }

  /** Applies the proposal: profile, ADR, vision and plan in one ChangeSet; the scaffold task ends READY. */
  async approve(projectId: string): Promise<InceptionViewDto> {
    this.requireProject(projectId);
    const current = this.record(projectId);
    if (!current || current.stage !== 'PROPOSAL' || current.status !== 'WAITING_USER' || !current.changeSetId) throw new Error('No hay una propuesta de inicio esperando tu aprobación.');
    if (current.error) throw new Error(`La propuesta está incompleta: ${current.error} Vuelve a generarla.`);
    if (!this.deps.repositoryPath(projectId)) throw new Error('Configura o inicializa el repositorio Git del proyecto antes de aprobar: la propuesta escribe la visión y el ADR en docs/.');
    const changeSet = this.deps.planning.find(current.changeSetId);
    if (!changeSet) throw new Error('La propuesta de inicio ya no existe; vuelve a generarla.');
    if (changeSet.status !== 'VALIDATED') throw new Error(`La propuesta no pasó la validación: ${changeSet.validationIssues.map(issue => issue.message).join(' ') || changeSet.status}. Vuelve a generarla.`);
    const applied = await this.deps.planning.apply(changeSet.id);
    const scaffold = scaffoldTempId(changeSet.operations as ChangeOperation[]);
    const scaffoldTaskId = scaffold ? applied.resolvedIds?.[scaffold] ?? null : null;
    const done: InceptionRecord = { ...current, stage: 'APPLIED', status: 'DONE', error: null, scaffoldTaskId, updatedAt: new Date().toISOString() };
    this.deps.store.save(done);
    this.deps.emit?.('graph:revision_updated', { projectId, revision: applied.revision });
    this.notify(done);
    return this.get(projectId);
  }

  /** Back to the start: stops a running call, forgets questions and answers and rejects a pending proposal. Nothing applied is undone. */
  restart(projectId: string): InceptionViewDto {
    this.requireProject(projectId);
    const current = this.record(projectId);
    if (current?.stage === 'APPLIED') throw new Error('El inicio ya se aplicó; los cambios al plan van por Planificar.');
    this.controllers.get(projectId)?.abort();
    if (current?.changeSetId) { const pending = this.deps.planning.find(current.changeSetId); if (pending && !['APPLIED', 'REJECTED'].includes(pending.status)) this.deps.planning.reject(pending.id); }
    this.deps.store.delete(projectId);
    this.deps.referenceFiles?.deleteAll(projectId);
    this.deps.emit?.('inception:updated', { projectId, stage: 'NOT_STARTED', status: 'IDLE' });
    return this.get(projectId);
  }

  /** App shutdown: aborts every running call (their processes are stopped); the record stays WORKING and reads as interrupted on the next open. */
  shutdown(): void { for (const controller of this.controllers.values()) controller.abort(); }

  /** Resolves when the background engine call (if any) has finished. */
  async settled(projectId: string): Promise<void> { await this.running.get(projectId)?.catch(() => undefined); }

  /** The inbox entry: what the inception needs from the user, or null when there is nothing to say. */
  activity(projectId: string): InceptionActivityDto | null {
    const view = this.get(projectId);
    if (view.stage === 'NOT_STARTED' || view.stage === 'APPLIED') return null;
    const changeSetId = view.proposal?.changeSetId ?? null, at = view.updatedAt ?? new Date().toISOString();
    const base = { stage: view.stage, status: view.status, changeSetId, at };
    if (view.status === 'WORKING') return { ...base, title: view.stage === 'ASK_GOALS' && !view.questions.length ? 'Inicio del proyecto: preparando las preguntas' : 'Inicio del proyecto: preparando la propuesta', detail: 'El asistente está trabajando; te avisaremos al terminar.', needsAttention: false };
    if (view.status === 'FAILED') return { ...base, title: 'Inicio del proyecto: falló la última llamada', detail: view.error ?? 'Vuelve a intentarlo.', needsAttention: true };
    if (view.stage === 'ASK_GOALS') return { ...base, title: 'Inicio del proyecto: te falta responder', detail: `${view.questions.length} pregunta${view.questions.length === 1 ? '' : 's'} sobre el objetivo y el alcance.`, needsAttention: true };
    return { ...base, title: 'Inicio del proyecto: te falta aprobar', detail: view.nextAction === 'SET_UP_REPOSITORY' ? 'Configura o inicializa el repositorio y aprueba la propuesta.' : view.nextAction === 'REVISE_PROPOSAL' ? 'La propuesta tiene problemas; revísala o vuelve a generarla.' : 'Revisa la visión, el stack y el plan inicial, y apruébalos.', needsAttention: true };
  }

  private launch(record: InceptionRecord, work: (signal: AbortSignal) => Promise<Omit<Partial<InceptionRecord>, 'usage'> & { usage: InceptionEngineUsage | null }>, failedStage: InceptionRecord['stage']): void {
    const controller = new AbortController();
    this.controllers.get(record.projectId)?.abort();
    this.controllers.set(record.projectId, controller);
    const task = (async () => {
      let patch: Omit<Partial<InceptionRecord>, 'usage'> & { usage: InceptionEngineUsage | null };
      try { patch = await work(controller.signal); }
      catch (error) { patch = { stage: failedStage, status: 'FAILED', error: error instanceof Error ? error.message : String(error), usage: null }; }
      // A voluntary cancellation (restart, shutdown) never turns into FAILED: whoever aborted owns the state.
      if (controller.signal.aborted) return;
      // A restart while the engine worked discards its answer.
      const latest = this.deps.store.find(record.projectId);
      if (!latest || latest.createdAt !== record.createdAt || latest.status !== 'WORKING') return;
      const { usage, ...rest } = patch;
      const next: InceptionRecord = { ...latest, ...rest, usage: usage ? [...latest.usage, usage] : latest.usage, updatedAt: new Date().toISOString() };
      if (!('error' in rest)) next.error = null;
      this.deps.store.save(next);
      this.notify(next);
    })().finally(() => { if (this.running.get(record.projectId) === task) this.running.delete(record.projectId); if (this.controllers.get(record.projectId) === controller) this.controllers.delete(record.projectId); });
    this.running.set(record.projectId, task);
  }

  private view(projectId: string, record: InceptionRecord | null): InceptionViewDto {
    const repositoryPath = this.deps.repositoryPath(projectId);
    const usage = (record?.usage ?? []).reduce((total, item) => ({ calls: total.calls + 1, inputTokens: total.inputTokens + item.inputTokens, outputTokens: total.outputTokens + item.outputTokens, cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens, cacheCreationTokens: total.cacheCreationTokens + item.cacheCreationTokens, costUsd: item.costUsd === null ? total.costUsd : (total.costUsd ?? 0) + item.costUsd }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: null as number | null });
    if (!record) return { projectId, stage: 'NOT_STARTED', status: 'IDLE', nextAction: 'START', brief: '', questions: [], answers: [], assumptions: [], proposal: null, error: null, model: null, repositoryPath, usage, notes: [], scaffoldTaskId: null, references: [], updatedAt: null };
    // WORKING with nothing running here: the app closed during the call.
    const interrupted = record.status === 'WORKING' && !this.running.has(projectId);
    const status: InceptionStatus = interrupted ? 'FAILED' : record.status;
    const proposal = record.changeSetId ? this.proposal(record.changeSetId) : null;
    const stage: InceptionStage = record.stage;
    const nextAction: InceptionNextAction = status === 'WORKING' ? 'WAIT' : stage === 'APPLIED' ? 'DONE'
      : status === 'FAILED' ? (stage === 'ASK_GOALS' && !record.questions.length ? 'RETRY_QUESTIONS' : 'RETRY_PROPOSAL')
      : stage === 'ASK_GOALS' ? 'ANSWER'
      : !proposal || proposal.status !== 'VALIDATED' || record.error ? 'REVISE_PROPOSAL' : !repositoryPath ? 'SET_UP_REPOSITORY' : 'APPROVE';
    return { projectId, stage, status, nextAction, brief: record.brief, questions: record.questions, answers: record.answers, assumptions: record.assumptions, proposal, error: interrupted ? 'La llamada se interrumpió (la app se cerró). Vuelve a intentarlo.' : record.error, model: record.model, repositoryPath, usage, notes: record.notes ?? [], scaffoldTaskId: record.scaffoldTaskId ?? null, references: (record.references ?? []).map(({ file: _file, ...visible }) => visible), updatedAt: record.updatedAt };
  }

  private proposal(changeSetId: string): InceptionProposalDto | null {
    const changeSet = this.deps.planning.find(changeSetId);
    if (!changeSet) return null;
    const verdict = decide(changeSet.operations as Array<{ type: string; [key: string]: unknown }>, DEFAULT_DECISION_POLICY, { featureTasks: new Set(), featureId: '', autoTasksSoFar: 0 });
    return { changeSetId, title: changeSet.title, rationale: changeSet.rationale, status: changeSet.status, issues: changeSet.validationIssues.map(issue => issue.message), decisionReasons: verdict.reasons, ...summarizeFoundationPlan(changeSet.operations as ChangeOperation[]) };
  }

  private chooseModel(projectId: string, requested: string | undefined): string | null {
    const models = this.deps.models(projectId), model = typeof requested === 'string' ? requested.trim() : '';
    if (model && !models.available.includes(model)) throw new Error(`El modelo ${model} no está disponible para planificar.`);
    return model || models.planning;
  }
  private projectInput(projectId: string, brief: string, props: { name: string; description?: string | null }, references: readonly InceptionReference[] = []) {
    const understood = references.flatMap(item => (item.status === 'TRANSLATED' && item.translation ? [{ kind: item.kind, name: item.name, note: item.note, translation: item.translation }] : []));
    return { name: props.name, description: props.description ?? null, brief, rootId: this.rootId(projectId), ...(understood.length ? { references: understood } : {}) };
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
    const models = this.deps.models(record.projectId);
    const model = ['sonnet', 'haiku'].find(alias => models.available.includes(alias)) ?? models.planning ?? undefined;
    const out = await translator.translate({ files: pending.map(item => ({ id: item.id, kind: item.kind, note: item.note, mimeType: item.mimeType, path: referenceFiles.pathOf(record.projectId, item.file) })), ...(model ? { model } : {}), signal });
    const byId = new Map(out.results.map(result => [result.id, result]));
    const references = record.references.map((item): InceptionReference => {
      const result = byId.get(item.id);
      if (!result) return item;
      return result.translation ? { ...item, status: 'TRANSLATED', error: null, translation: result.translation } : { ...item, status: 'FAILED', error: result.error ?? 'No se pudo analizar el archivo.', translation: null };
    });
    const latest = this.deps.store.find(record.projectId);
    if (!signal.aborted && latest && latest.createdAt === record.createdAt && latest.status === 'WORKING') {
      this.deps.store.save({ ...latest, references, usage: out.usage ? [...latest.usage, out.usage] : latest.usage, updatedAt: new Date().toISOString() });
    }
    const failed = references.filter(item => item.status === 'FAILED');
    if (failed.length) throw new Error(`No se pudo analizar ${failed.map(item => `«${item.name}»`).join(', ')}: ${failed[0]!.error} Vuelve a intentarlo o empieza de nuevo sin esa referencia.`);
    return references;
  }
  private rootId(projectId: string): string { const root = this.deps.graph.listEntities(projectId).find(entity => entity.entityType === 'PROJECT_ROOT'); if (!root) throw new Error('El proyecto no tiene nodo raíz.'); return root.id; }
  private record(projectId: string): InceptionRecord | null { return this.deps.store.find(projectId); }
  private requireProject(projectId: string) { const project = this.deps.projects.findById(projectId); if (!project) throw new Error('Proyecto no encontrado.'); return project; }
  private notify(record: InceptionRecord): void { this.deps.emit?.('inception:updated', { projectId: record.projectId, stage: record.stage, status: record.status }); }
}
