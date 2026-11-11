import { randomUUID } from 'node:crypto';
import type { AgentExecution } from '../../domain/agents/models.js';
import { ACTIVE_PILOT_STATUSES, type AutonomyLevel, type FeatureAutonomy, type PilotEventKind, type PilotRun, type PilotStatus } from '../../domain/autonomy/models.js';
import type { FeatureTaskView, PilotRepositoryPort } from '../ports/pilot-port.js';
import { nextTaskGroup } from './task-grouping.js';
import { coveredWorkItems } from '../../domain/agents/models.js';
import type { AgentOrchestrator, PlanProposalOutcome } from './agent-orchestrator.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
type Usage = { utilization: number | null; window: string; resetsAt: string | null; status: string };
/** `closed`: the app is shutting down and the database may already be closed — the loop must exit without writing. */
interface LoopState { stop: boolean; closed: boolean; currentExecution: string | null }

/**
 * Autonomy per feature (Stage 3).
 * - AUTO_ACCEPT: a completed run of the feature is integrated on its own when the gates pass.
 * - PILOT: also picks and launches the next READY task, retries failures with their context, pauses near the usage
 *   limit, and stops to ask the user — with the reason — whenever a human decision is needed.
 * Gates for accepting without a human: the run COMPLETED (audit passed) and at least one verification command ran and
 * passed. Without configured checks nothing is accepted automatically.
 */
export class FeaturePilot {
  private readonly loops = new Map<string, LoopState>();
  private readonly resumeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly repository: PilotRepositoryPort,
    private readonly emit: (channel: 'pilot:updated', payload: { projectId: string; featureId: string; status: PilotStatus | null }) => void = () => undefined,
    private readonly options: { pollMs?: number } = {},
  ) {
    orchestrator.onExecutionFinished(execution => { void this.autoAccept(execution); });
  }

  getAutonomy(projectId: string, featureId: string): FeatureAutonomy { return this.repository.getAutonomy(projectId, featureId); }

  setAutonomy(projectId: string, featureId: string, input: { level: AutonomyLevel; executionModel?: string | null; escalationModel?: string | null; maxAttempts?: number; usagePauseThreshold?: number; groupTasks?: boolean; maxGroupSize?: number }): FeatureAutonomy {
    if (!['MANUAL', 'AUTO_ACCEPT', 'PILOT'].includes(input.level)) throw new Error(`Nivel de autonomía desconocido: ${input.level}`);
    const current = this.repository.getAutonomy(projectId, featureId);
    const available = this.orchestrator.listProfiles(projectId).find(profile => profile.roleKey === 'DEVELOPER')?.availableModels ?? [];
    for (const model of [input.executionModel, input.escalationModel]) if (model && !available.includes(model)) throw new Error(`El modelo ${model} no está disponible.`);
    const maxAttempts = input.maxAttempts ?? current.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('Los intentos por tarea deben estar entre 1 y 5.');
    const usagePauseThreshold = input.usagePauseThreshold ?? current.usagePauseThreshold;
    if (!(usagePauseThreshold >= 0.5 && usagePauseThreshold <= 0.99)) throw new Error('El umbral de pausa debe estar entre 50 % y 99 %.');
    const maxGroupSize = input.maxGroupSize ?? current.maxGroupSize;
    if (!Number.isInteger(maxGroupSize) || maxGroupSize < 1 || maxGroupSize > 5) throw new Error('El tamaño del grupo debe estar entre 1 y 5 tareas.');
    const next: FeatureAutonomy = { featureId, projectId, level: input.level, executionModel: input.executionModel ?? null, escalationModel: input.escalationModel ?? null, maxAttempts, usagePauseThreshold, groupTasks: input.groupTasks ?? current.groupTasks, maxGroupSize };
    this.repository.saveAutonomy(next);
    if (next.level !== 'PILOT') { const run = this.repository.latestRun(featureId); if (run && ACTIVE_PILOT_STATUSES.has(run.status)) void this.stop(projectId, featureId, 'El nivel de autonomía dejó de ser piloto.'); }
    this.notify(projectId, featureId);
    return next;
  }

  status(projectId: string, featureId: string) {
    const run = this.repository.latestRun(featureId);
    return { autonomy: this.repository.getAutonomy(projectId, featureId), run, events: run ? this.repository.listEvents(run.id, 100) : [], tasks: this.repository.listFeatureTasks(projectId, featureId), usage: this.lastUsage(projectId), running: run ? this.loops.has(run.id) : false };
  }

  /** Starts the autopilot. `acknowledgeCost` must be true: the UI shows the cost warning before calling this. */
  start(projectId: string, featureId: string, input: { acknowledgeCost: boolean }): PilotRun {
    const autonomy = this.repository.getAutonomy(projectId, featureId);
    if (autonomy.level !== 'PILOT') throw new Error('Activa el nivel "Piloto" en esta feature antes de iniciarlo.');
    if (!input.acknowledgeCost) throw new Error('Confirma que entiendes el costo del piloto automático antes de iniciarlo.');
    const active = this.repository.listRuns(projectId, ['RUNNING', 'PAUSED']);
    if (active.length) throw new Error('Ya hay un piloto activo en este proyecto; solo puede correr uno a la vez.');
    const run: PilotRun = { id: randomUUID(), projectId, featureId, status: 'RUNNING', reason: null, startedAt: new Date().toISOString(), endedAt: null };
    this.repository.createRun(run);
    this.log(run, 'STARTED', 'Piloto iniciado.');
    void this.loop(run);
    return run;
  }

  async stop(projectId: string, featureId: string, reason = 'Detenido por el usuario.'): Promise<PilotRun | null> {
    const run = this.repository.latestRun(featureId);
    if (!run) return null;
    this.clearResume(run.id);
    const state = this.loops.get(run.id);
    if (state) {
      state.stop = true;
      if (state.currentExecution) await this.orchestrator.cancel(state.currentExecution).catch(() => undefined);
    }
    if (!['COMPLETED', 'STOPPED', 'FAILED'].includes(run.status)) this.finish(run, 'STOPPED', reason);
    return this.repository.findRun(run.id);
  }

  /** Continues a paused or waiting autopilot (for example after the user fixed what it asked for). */
  resume(projectId: string, featureId: string): PilotRun {
    const run = this.repository.latestRun(featureId);
    if (!run || !['PAUSED', 'WAITING_USER'].includes(run.status)) throw new Error('No hay un piloto pausado o esperando en esta feature.');
    if (this.loops.has(run.id)) throw new Error('El piloto ya está en marcha.');
    const others = this.repository.listRuns(projectId, ['RUNNING', 'PAUSED']).filter(item => item.id !== run.id);
    if (others.length) throw new Error('Ya hay otro piloto activo en este proyecto.');
    this.clearResume(run.id);
    this.setStatus(run, 'RUNNING', null);
    this.log(run, 'RESUMED', 'Piloto reanudado.');
    void this.loop({ ...run, status: 'RUNNING' });
    return { ...run, status: 'RUNNING', reason: null };
  }

  /** Runs left RUNNING by a process that died cannot continue: mark them stopped. */
  reconcile(projectId: string): void {
    for (const run of this.repository.listRuns(projectId, ['RUNNING', 'PAUSED'])) {
      if (this.loops.has(run.id) || this.resumeTimers.has(run.id)) continue;
      this.finish(run, 'STOPPED', 'Piloto interrumpido: la aplicación se cerró. Reanúdalo cuando quieras.');
    }
  }

  shutdown(): void {
    for (const state of this.loops.values()) { state.stop = true; state.closed = true; }
    for (const timer of this.resumeTimers.values()) clearTimeout(timer);
    this.resumeTimers.clear();
  }

  private async loop(run: PilotRun): Promise<void> {
    const state: LoopState = { stop: false, closed: false, currentExecution: null };
    this.loops.set(run.id, state);
    const attempts = new Map<string, number>();
    const failures = new Map<string, string>();
    // Members of a failed group, by leader: the retry runs the same group with the error as context.
    const groups = new Map<string, string[]>();
    try {
      while (!state.stop) {
        const autonomy = this.repository.getAutonomy(run.projectId, run.featureId);
        if (autonomy.level !== 'PILOT') return this.finish(run, 'STOPPED', 'El nivel de autonomía dejó de ser piloto.');
        const all = this.repository.listFeatureTasks(run.projectId, run.featureId);
        const open = all.filter(task => !['DONE', 'ARCHIVED'].includes(task.status));
        if (!open.length) return this.finish(run, 'COMPLETED', 'Todas las tareas de la feature están cerradas.');

        const reviewing = open.find(task => task.status === 'IN_REVIEW');
        if (reviewing) {
          const pending = this.latestReviewable(run.projectId, reviewing.id);
          if (!pending) return this.waitUser(run, `${reviewing.displayKey} está en revisión sin una ejecución aceptable. Revísala en Agentes.`, reviewing.id);
          if (!await this.acceptWithGates(run, pending, reviewing.displayKey)) return;
          continue;
        }
        const running = open.find(task => task.status === 'IN_PROGRESS');
        if (running) {
          const active = this.orchestrator.listExecutions(run.projectId).find(execution => coveredWorkItems(execution).includes(running.id) && !TERMINAL.has(execution.status));
          if (!active) return this.waitUser(run, `${running.displayKey} está en curso sin ejecución activa.`, running.id);
          state.currentExecution = active.id;
          await this.waitTerminal(active.id, state);
          state.currentExecution = null;
          continue;
        }
        // A feature that depends on another one with open tasks cannot run yet (its branch would miss that work).
        const blocker = this.orchestrator.featureBlocker(run.projectId, run.featureId);
        if (blocker) return this.waitUser(run, `${blocker} Termínalas (o integra esa feature) y reanuda el piloto.`, null);
        // Etapa 0: with grouping on, 2–maxGroupSize small tasks run in one execution (rules in task-grouping.ts). A retried leader keeps its group.
        const grouping = autonomy.groupTasks && autonomy.maxGroupSize > 1;
        const group = grouping ? nextTaskGroup(all, { maxGroupSize: autonomy.maxGroupSize, projectHasDoneTasks: this.repository.countDoneTasks(run.projectId) > 0 }) : null;
        const byId = new Map(all.map(task => [task.id, task]));
        const next = (group ? byId.get(group.leader.id) : undefined) ?? open.find(task => task.status === 'READY');
        if (!next) return this.waitUser(run, `No hay tareas listas: ${open.map(task => `${task.displayKey} (${task.status})`).join(', ')}. Pasa a READY las que estén en DRAFT; las BLOCKED esperan dependencias.`, null);
        const remembered = failures.has(next.id) ? groups.get(next.id) : undefined;
        const members: FeatureTaskView[] = (remembered ?? group?.tasks.map(task => task.id) ?? [next.id]).flatMap(id => { const task = byId.get(id); return task ? [task] : []; });
        const label = members.map(task => task.displayKey).join(', ');

        const usage = this.lastUsage(run.projectId);
        if (usage?.utilization != null && usage.utilization >= autonomy.usagePauseThreshold) return this.pause(run, usage, autonomy.usagePauseThreshold);

        const attempt = (attempts.get(next.id) ?? 0) + 1;
        const escalate = attempt >= autonomy.maxAttempts && attempt > 1 && Boolean(autonomy.escalationModel);
        const model = (escalate ? autonomy.escalationModel : autonomy.executionModel) ?? undefined;
        const profileId = this.orchestrator.listProfiles(run.projectId).find(profile => profile.roleKey === 'DEVELOPER')?.id;
        if (!profileId) return this.finish(run, 'FAILED', 'El proyecto no tiene un perfil DEVELOPER.');
        this.log(run, escalate ? 'ESCALATED' : members.length > 1 ? 'GROUP_STARTED' : 'TASK_STARTED', `${label}: intento ${attempt} de ${autonomy.maxAttempts}${model ? ` con ${model}` : ''}${members.length > 1 ? ` (grupo de ${members.length} tareas en una ejecución)` : ''}.`, next.id);
        let execution: AgentExecution;
        try {
          execution = await this.orchestrator.start({ projectId: run.projectId, workItemId: next.id, ...(members.length > 1 ? { workItemIds: members.slice(1).map(task => task.id) } : {}), profileId, ...(model ? { model } : {}), ...(failures.has(next.id) ? { retryContext: failures.get(next.id)! } : {}) });
        } catch (error) {
          return this.waitUser(run, `No se pudo iniciar ${label}: ${message(error)}`, next.id);
        }
        state.currentExecution = execution.id;
        const final = await this.waitTerminal(execution.id, state);
        state.currentExecution = null;
        if (state.stop) break;
        if (final.status === 'COMPLETED') {
          if (!await this.acceptWithGates(run, final, label)) return;
          attempts.delete(next.id); failures.delete(next.id); groups.delete(next.id);
          continue;
        }
        if (final.status === 'CANCELLED') return this.finish(run, 'STOPPED', `Se canceló la ejecución de ${label}.`);
        attempts.set(next.id, attempt);
        failures.set(next.id, this.failureContext(final));
        groups.set(next.id, members.map(task => task.id));
        if (attempt >= autonomy.maxAttempts) return this.waitUser(run, `${label} falló ${attempt} ${attempt === 1 ? 'vez' : 'veces'}. Último motivo: ${final.resultSummary ?? 'sin detalle'}`, next.id, final.id);
        this.log(run, 'RETRY', `${label} falló (${final.resultSummary ?? 'sin detalle'}); se reintentará${members.length > 1 ? ' el grupo entero' : ''} con ese error como contexto.`, next.id, final.id);
      }
      if (!state.closed) this.finish(run, 'STOPPED', 'Detenido por el usuario.');
    } catch (error) {
      // On shutdown the run stays RUNNING and is reconciled as interrupted on the next open.
      if (!state.closed) { try { this.finish(run, 'FAILED', `El piloto se detuvo por un error: ${message(error)}`); } catch { /* never reject: the loop runs detached */ } }
    } finally {
      this.loops.delete(run.id);
    }
  }

  /** Accepts a completed run when the gates pass; otherwise hands it to the user. Returns whether the loop may go on. */
  private async acceptWithGates(run: PilotRun, execution: AgentExecution, key: string): Promise<boolean> {
    const gate = this.gate(execution);
    if (!gate.ok) { this.waitUser(run, `${key} terminó pero no se acepta sola: ${gate.reason}`, execution.workItemId, execution.id); return false; }
    const result = await this.orchestrator.accept(execution.id, { note: 'Aceptada por el piloto automático: auditoría y comprobaciones en verde.' });
    if (!result.merged) { this.waitUser(run, `No se pudo integrar ${key}: ${result.conflict?.detail ?? 'conflicto'}${result.conflict?.files.length ? ` (${result.conflict.files.join(', ')})` : ''}`, execution.workItemId, execution.id); return false; }
    this.log(run, 'TASK_ACCEPTED', `${key} aceptada e integrada en ${execution.baseBranch} (${result.execution.mergedCommit?.slice(0, 8)}).`, execution.workItemId, execution.id);
    return this.handleProposal(run, result.proposal ?? null, key, execution);
  }

  /**
   * The agent may propose plan changes when closing a task (the orchestrator already applied or stored them per the
   * project's decision policy). APPLIED: the new tasks are in the graph and the loop picks them up on its next pass.
   * PENDING: the user decides in Planning — the pilot waits; on resume it goes on with whatever the graph holds then,
   * resolved or not. INVALID: logged only; a bad proposal never stops the execution.
   */
  private handleProposal(run: PilotRun, proposal: PlanProposalOutcome | null, key: string, execution: AgentExecution): boolean {
    if (!proposal) return true;
    const reasons = proposal.reasons.map(reason => reason.trim().replace(/\.+$/, '')).filter(Boolean).join('; ');
    if (proposal.outcome === 'APPLIED') { this.log(run, 'PLAN_CHANGED', `Plan modificado al cerrar ${key}: ${proposal.title}.${reasons ? ` ${reasons}.` : ''} Las tareas nuevas entran en el recorrido.`, execution.workItemId, execution.id); return true; }
    if (proposal.outcome === 'INVALID') { this.log(run, 'PLAN_PROPOSAL', `Propuesta de ${key} descartada (${proposal.title}): ${reasons || 'inválida'}. El piloto continúa.`, execution.workItemId, execution.id); return true; }
    this.log(run, 'PLAN_PROPOSAL', `Propuesta de ${key} pendiente de tu decisión: ${proposal.title}.`, execution.workItemId, execution.id);
    this.waitUser(run, `El agente propone cambios al plan que requieren tu decisión: ${proposal.title}.${reasons ? ` ${reasons}.` : ''} Revísalos en Planificación y reanuda el piloto.`, execution.workItemId, execution.id);
    return false;
  }

  private async autoAccept(execution: AgentExecution): Promise<void> {
    if (execution.status !== 'COMPLETED' || !execution.workItemId) return;
    try {
      const featureId = this.repository.featureOf(execution.projectId, execution.workItemId);
      if (!featureId || this.repository.getAutonomy(execution.projectId, featureId).level !== 'AUTO_ACCEPT') return;
      if (!this.gate(execution).ok) return;
      // A plan proposal was already applied or stored by the orchestrator per the project's policy; without a pilot run
      // there is no log to write and nothing to stop: the notification refreshes the views (Planning shows pending ones).
      await this.orchestrator.accept(execution.id, { note: 'Aceptada automáticamente (nivel auto-aceptar): auditoría y comprobaciones en verde.' });
      this.notify(execution.projectId, featureId);
    } catch { /* stays IN_REVIEW for the user */ }
  }

  private gate(execution: AgentExecution): { ok: true } | { ok: false; reason: string } {
    if (execution.status !== 'COMPLETED') return { ok: false, reason: 'la ejecución no terminó bien.' };
    const commands = (execution.testSummary as { commands?: Array<{ exitCode: number }> } | null)?.commands ?? [];
    if (!commands.length) return { ok: false, reason: 'no hay comandos de verificación configurados en la política. Revísala y acéptala a mano, o configura comandos.' };
    if (commands.some(command => command.exitCode !== 0)) return { ok: false, reason: 'alguna comprobación falló.' };
    return { ok: true };
  }

  private latestReviewable(projectId: string, workItemId: string): AgentExecution | null {
    return this.orchestrator.listExecutions(projectId).find(execution => coveredWorkItems(execution).includes(workItemId) && execution.status === 'COMPLETED' && (!execution.reviewStatus || execution.reviewStatus === 'MERGE_CONFLICT')) ?? null;
  }

  private failureContext(execution: AgentExecution): string {
    const commands = (execution.testSummary as { commands?: Array<{ command: string; exitCode: number; output: string }> } | null)?.commands ?? [];
    const failed = commands.filter(command => command.exitCode !== 0).map(command => `$ ${command.command}\n${command.output.slice(-1500)}`);
    const denied = this.orchestrator.listEvents(execution.id).flatMap(record => record.event.type === 'ACTION_DENIED' ? [`${record.event.toolName}: ${record.event.target}`] : []);
    return [`Motivo: ${execution.resultSummary ?? 'sin detalle'}`, ...failed, ...(denied.length ? [`Acciones denegadas por la política: ${denied.join('; ')}`] : [])].join('\n\n').slice(0, 6000);
  }

  /** The latest usage-window report seen in any recent run of the project. */
  private lastUsage(projectId: string): Usage | null {
    for (const execution of this.orchestrator.listExecutions(projectId).slice(0, 5)) {
      const report = [...this.orchestrator.listEvents(execution.id)].reverse().find(record => record.event.type === 'RATE_LIMIT_UPDATED')?.event;
      if (report?.type === 'RATE_LIMIT_UPDATED') return { utilization: report.utilization, window: report.window, resetsAt: report.resetsAt, status: report.status };
    }
    return null;
  }

  private pause(run: PilotRun, usage: Usage, threshold: number): void {
    const resumeAt = usage.resetsAt && Date.parse(usage.resetsAt) > Date.now() ? Date.parse(usage.resetsAt) + 60_000 : Date.now() + 30 * 60_000;
    const reason = `Uso de la ventana ${usage.window} al ${Math.round((usage.utilization ?? 0) * 100)} % (umbral ${Math.round(threshold * 100)} %). Se reanudará hacia ${new Date(resumeAt).toLocaleString('es')}.`;
    this.setStatus(run, 'PAUSED', reason);
    this.log(run, 'PAUSED', reason);
    // The window must be re-checked on resume: if it has not reset yet, the loop pauses again.
    const timer = setTimeout(() => { this.resumeTimers.delete(run.id); const current = this.repository.findRun(run.id); if (current?.status === 'PAUSED') { try { this.resume(run.projectId, run.featureId); } catch { /* user changed something */ } } }, Math.max(1_000, resumeAt - Date.now()));
    timer.unref?.();
    this.resumeTimers.set(run.id, timer);
  }

  private async waitTerminal(executionId: string, state: LoopState): Promise<AgentExecution> {
    const poll = this.options.pollMs ?? 500;
    for (;;) {
      const execution = this.find(executionId);
      if (execution && TERMINAL.has(execution.status)) return execution;
      if (state.stop && execution && !TERMINAL.has(execution.status)) await this.orchestrator.cancel(executionId).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, poll));
    }
  }

  private find(executionId: string): AgentExecution | null { return this.orchestrator.findExecution(executionId); }

  private waitUser(run: PilotRun, reason: string, workItemId: string | null, executionId: string | null = null): void {
    this.setStatus(run, 'WAITING_USER', reason);
    this.log(run, 'WAITING_USER', reason, workItemId, executionId);
  }

  private finish(run: PilotRun, status: 'COMPLETED' | 'STOPPED' | 'FAILED', reason: string): void {
    // Idempotent: stop() may finish a run whose loop then notices and tries to finish it again.
    const current = this.repository.findRun(run.id);
    if (current && ['COMPLETED', 'STOPPED', 'FAILED'].includes(current.status)) return;
    this.repository.updateRun(run.id, status, reason, new Date().toISOString());
    this.log(run, status, reason);
  }

  private setStatus(run: PilotRun, status: PilotStatus, reason: string | null): void {
    this.repository.updateRun(run.id, status, reason, null);
    this.notify(run.projectId, run.featureId, status);
  }

  private log(run: PilotRun, kind: PilotEventKind, text: string, workItemId: string | null = null, executionId: string | null = null): void {
    this.repository.appendEvent(run.id, kind, text, workItemId, executionId);
    this.notify(run.projectId, run.featureId);
  }

  private notify(projectId: string, featureId: string, status?: PilotStatus): void {
    this.emit('pilot:updated', { projectId, featureId, status: status ?? this.repository.latestRun(featureId)?.status ?? null });
  }

  private clearResume(runId: string): void { const timer = this.resumeTimers.get(runId); if (timer) { clearTimeout(timer); this.resumeTimers.delete(runId); } }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
