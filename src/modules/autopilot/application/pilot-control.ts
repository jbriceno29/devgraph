import { ACTIVE_PILOT_STATUSES, type AutonomyLevel, type FeatureAutonomy, type PilotRun } from '../domain/models.js';
import {
  type PilotKernel,
  type Usage,
  clearResume,
  finish,
  lastUsage,
  log,
  notify,
  setStatus,
} from './pilot-kernel.js';
import { loop } from './pilot-loop.js';

export function setAutonomy(
  k: PilotKernel,
  projectId: string,
  featureId: string,
  input: {
    level: AutonomyLevel;
    executionModel?: string | null;
    escalationModel?: string | null;
    maxAttempts?: number;
    usagePauseThreshold?: number;
    groupTasks?: boolean;
    maxGroupSize?: number;
    reviewModel?: string | null;
  },
): FeatureAutonomy {
  if (!['MANUAL', 'AUTO_ACCEPT', 'PILOT'].includes(input.level))
    throw new Error(`Nivel de autonomía desconocido: ${input.level}`);
  const current = k.repository.getAutonomy(projectId, featureId);
  const available =
    k.orchestrator.listProfiles(projectId).find(profile => profile.roleKey === 'DEVELOPER')?.availableModels ?? [];
  for (const model of [input.executionModel, input.escalationModel, input.reviewModel])
    if (model && !available.includes(model)) throw new Error(`El modelo ${model} no está disponible.`);
  const maxAttempts = input.maxAttempts ?? current.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
    throw new Error('Los intentos por tarea deben estar entre 1 y 5.');
  const usagePauseThreshold = input.usagePauseThreshold ?? current.usagePauseThreshold;
  if (!(usagePauseThreshold >= 0.5 && usagePauseThreshold <= 0.99))
    throw new Error('El umbral de pausa debe estar entre 50 % y 99 %.');
  const maxGroupSize = input.maxGroupSize ?? current.maxGroupSize;
  if (!Number.isInteger(maxGroupSize) || maxGroupSize < 1 || maxGroupSize > 5)
    throw new Error('El tamaño del grupo debe estar entre 1 y 5 tareas.');
  const next: FeatureAutonomy = {
    featureId,
    projectId,
    level: input.level,
    executionModel: input.executionModel ?? null,
    escalationModel: input.escalationModel ?? null,
    maxAttempts,
    usagePauseThreshold,
    groupTasks: input.groupTasks ?? current.groupTasks,
    maxGroupSize,
    reviewModel: input.reviewModel === undefined ? current.reviewModel : input.reviewModel || null,
  };
  k.repository.saveAutonomy(next);
  if (next.level !== 'PILOT') {
    const run = k.repository.latestRun(featureId);
    if (run && ACTIVE_PILOT_STATUSES.has(run.status))
      void stop(k, projectId, featureId, 'El nivel de autonomía dejó de ser piloto.');
  }
  notify(k, projectId, featureId);
  return next;
}

export function status(k: PilotKernel, projectId: string, featureId: string) {
  const run = k.repository.latestRun(featureId);
  return {
    autonomy: k.repository.getAutonomy(projectId, featureId),
    run,
    events: run ? k.repository.listEvents(run.id, 100) : [],
    tasks: k.repository.listFeatureTasks(projectId, featureId),
    usage: lastUsage(k, projectId),
    running: run ? k.loops.has(run.id) : false,
  };
}

/** Starts the autopilot. `acknowledgeCost` must be true: the UI shows the cost warning before calling k. */
export function start(
  k: PilotKernel,
  projectId: string,
  featureId: string,
  input: { acknowledgeCost: boolean },
): PilotRun {
  const autonomy = k.repository.getAutonomy(projectId, featureId);
  if (autonomy.level !== 'PILOT') throw new Error('Activa el nivel "Piloto" en esta feature antes de iniciarlo.');
  if (!input.acknowledgeCost)
    throw new Error('Confirma que entiendes el costo del piloto automático antes de iniciarlo.');
  const active = k.repository.listRuns(projectId, ['RUNNING', 'PAUSED']);
  if (active.length) throw new Error('Ya hay un piloto activo en este proyecto; solo puede correr uno a la vez.');
  const run: PilotRun = {
    id: globalThis.crypto.randomUUID(),
    projectId,
    featureId,
    status: 'RUNNING',
    reason: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  k.repository.createRun(run);
  log(k, run, 'STARTED', 'Piloto iniciado.');
  void loop(k, run);
  return run;
}

export async function stop(
  k: PilotKernel,
  projectId: string,
  featureId: string,
  reason = 'Detenido por el usuario.',
): Promise<PilotRun | null> {
  const run = k.repository.latestRun(featureId);
  if (!run) return null;
  clearResume(k, run.id);
  const state = k.loops.get(run.id);
  if (state) {
    state.stop = true;
    if (state.currentExecution) await k.orchestrator.cancel(state.currentExecution).catch(() => undefined);
  }
  if (!['COMPLETED', 'STOPPED', 'FAILED'].includes(run.status)) finish(k, run, 'STOPPED', reason);
  return k.repository.findRun(run.id);
}

/** Continues a paused or waiting autopilot (for example after the user fixed what it asked for). */
export function resume(k: PilotKernel, projectId: string, featureId: string): PilotRun {
  const run = k.repository.latestRun(featureId);
  if (!run || !['PAUSED', 'WAITING_USER'].includes(run.status))
    throw new Error('No hay un piloto pausado o esperando en esta feature.');
  if (k.loops.has(run.id)) throw new Error('El piloto ya está en marcha.');
  const others = k.repository.listRuns(projectId, ['RUNNING', 'PAUSED']).filter(item => item.id !== run.id);
  if (others.length) throw new Error('Ya hay otro piloto activo en este proyecto.');
  clearResume(k, run.id);
  setStatus(k, run, 'RUNNING', null);
  log(k, run, 'RESUMED', 'Piloto reanudado.');
  void loop(k, { ...run, status: 'RUNNING' });
  return { ...run, status: 'RUNNING', reason: null };
}

/** Runs left RUNNING by a process that died cannot continue: mark them stopped. */
export function reconcile(k: PilotKernel, projectId: string): void {
  for (const run of k.repository.listRuns(projectId, ['RUNNING', 'PAUSED'])) {
    if (k.loops.has(run.id) || k.resumeTimers.has(run.id)) continue;
    finish(k, run, 'STOPPED', 'Piloto interrumpido: la aplicación se cerró. Reanúdalo cuando quieras.');
  }
}

export function shutdown(k: PilotKernel): void {
  for (const state of k.loops.values()) {
    state.stop = true;
    state.closed = true;
  }
  for (const timer of k.resumeTimers.values()) clearTimeout(timer);
  k.resumeTimers.clear();
}

export function pause(k: PilotKernel, run: PilotRun, usage: Usage, threshold: number): void {
  const resumeAt =
    usage.resetsAt && Date.parse(usage.resetsAt) > Date.now()
      ? Date.parse(usage.resetsAt) + 60_000
      : Date.now() + 30 * 60_000;
  const reason = `Uso de la ventana ${usage.window} al ${Math.round((usage.utilization ?? 0) * 100)} % (umbral ${Math.round(threshold * 100)} %). Se reanudará hacia ${new Date(resumeAt).toLocaleString('es')}.`;
  setStatus(k, run, 'PAUSED', reason);
  log(k, run, 'PAUSED', reason);
  // The window must be re-checked on resume: if it has not reset yet, the loop pauses again.
  const timer = setTimeout(
    () => {
      k.resumeTimers.delete(run.id);
      const current = k.repository.findRun(run.id);
      if (current?.status === 'PAUSED') {
        try {
          resume(k, run.projectId, run.featureId);
        } catch {
          /* user changed something */
        }
      }
    },
    Math.max(1_000, resumeAt - Date.now()),
  );
  timer.unref?.();
  k.resumeTimers.set(run.id, timer);
}
