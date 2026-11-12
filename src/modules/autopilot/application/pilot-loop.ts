import { type AgentExecution, coveredWorkItems, unapprovedPackages } from '../../execution/index.js';
import type { FeatureAutonomy, PilotRun } from '../domain/models.js';
import { acceptWithGates } from './pilot-acceptance.js';
import { pause } from './pilot-control.js';
import {
  type LoopState,
  type PilotKernel,
  TERMINAL,
  failureContext,
  finish,
  lastUsage,
  latestReviewable,
  log,
  message,
  waitTerminal,
  waitUser,
} from './pilot-kernel.js';
import type { FeatureTaskView } from './ports/pilot-port.js';
import { nextTaskGroup } from './task-grouping.js';

/** What the loop remembers between passes: attempts and the last error per task, and the group a failed leader ran. */
interface LoopMemory {
  attempts: Map<string, number>;
  failures: Map<string, string>;
  /** Members of a failed group, by leader: the retry runs the same group with the error as context. */
  groups: Map<string, string[]>;
}
/** `continue`: next pass. `end`: the run was finished or handed to the user. `break`: stopped by the user. */
type Step = 'continue' | 'end' | 'break';
interface NextTask {
  next: FeatureTaskView;
  members: FeatureTaskView[];
  label: string;
}

export async function loop(k: PilotKernel, run: PilotRun): Promise<void> {
  const state: LoopState = { stop: false, closed: false, currentExecution: null };
  k.loops.set(run.id, state);
  const memory: LoopMemory = { attempts: new Map(), failures: new Map(), groups: new Map() };
  try {
    while (!state.stop) {
      const step = await pass(k, run, state, memory);
      if (step === 'end') return;
      if (step === 'break') break;
    }
    if (!state.closed) finish(k, run, 'STOPPED', 'Detenido por el usuario.');
  } catch (error) {
    // On shutdown the run stays RUNNING and is reconciled as interrupted on the next open.
    if (!state.closed) {
      try {
        finish(k, run, 'FAILED', `El piloto se detuvo por un error: ${message(error)}`);
      } catch {
        /* never reject: the loop runs detached */
      }
    }
  } finally {
    k.loops.delete(run.id);
  }
}

/** One pass: finish when everything is closed, settle what is in review or running, otherwise run the next task. */
async function pass(k: PilotKernel, run: PilotRun, state: LoopState, memory: LoopMemory): Promise<Step> {
  const autonomy = k.repository.getAutonomy(run.projectId, run.featureId);
  if (autonomy.level !== 'PILOT') {
    finish(k, run, 'STOPPED', 'El nivel de autonomía dejó de ser piloto.');
    return 'end';
  }
  const all = k.repository.listFeatureTasks(run.projectId, run.featureId);
  const open = all.filter(task => !['DONE', 'ARCHIVED'].includes(task.status));
  if (!open.length) {
    finish(k, run, 'COMPLETED', 'Todas las tareas de la feature están cerradas.');
    return 'end';
  }
  const settled = await settleOpenWork(k, run, state, open);
  if (settled) return settled;
  const picked = pickNext(k, run, autonomy, all, open, memory);
  if (!picked) return 'end';
  return runTask(k, run, state, memory, autonomy, picked);
}

/** A task in review is accepted (or handed over); a task in progress is waited for. Null when there is neither. */
async function settleOpenWork(
  k: PilotKernel,
  run: PilotRun,
  state: LoopState,
  open: FeatureTaskView[],
): Promise<Step | null> {
  const reviewing = open.find(task => task.status === 'IN_REVIEW');
  if (reviewing) {
    const pending = latestReviewable(k, run.projectId, reviewing.id);
    if (!pending) {
      waitUser(
        k,
        run,
        `${reviewing.displayKey} está en revisión sin una ejecución aceptable. Revísala en Agentes.`,
        reviewing.id,
      );
      return 'end';
    }
    return (await acceptWithGates(k, run, pending, reviewing.displayKey)) ? 'continue' : 'end';
  }
  const running = open.find(task => task.status === 'IN_PROGRESS');
  if (!running) return null;
  const active = k.orchestrator
    .listExecutions(run.projectId)
    .find(execution => coveredWorkItems(execution).includes(running.id) && !TERMINAL.has(execution.status));
  if (!active) {
    waitUser(k, run, `${running.displayKey} está en curso sin ejecución activa.`, running.id);
    return 'end';
  }
  state.currentExecution = active.id;
  await waitTerminal(k, active.id, state);
  state.currentExecution = null;
  return 'continue';
}

/** The next READY task (or group, with grouping on), or null after handing the reason to the user. */
function pickNext(
  k: PilotKernel,
  run: PilotRun,
  autonomy: FeatureAutonomy,
  all: FeatureTaskView[],
  open: FeatureTaskView[],
  memory: LoopMemory,
): NextTask | null {
  // A feature that depends on another one with open tasks cannot run yet (its branch would miss that work).
  const blocker = k.orchestrator.featureBlocker(run.projectId, run.featureId);
  if (blocker) {
    waitUser(k, run, `${blocker} Termínalas (o integra esa feature) y reanuda el piloto.`, null);
    return null;
  }
  // Etapa 0: with grouping on, 2–maxGroupSize small tasks run in one execution (rules in task-grouping.ts). A retried leader keeps its group.
  const group =
    autonomy.groupTasks && autonomy.maxGroupSize > 1
      ? nextTaskGroup(all, {
          maxGroupSize: autonomy.maxGroupSize,
          projectHasDoneTasks: k.repository.countDoneTasks(run.projectId) > 0,
        })
      : null;
  const byId = new Map(all.map(task => [task.id, task]));
  const next = (group ? byId.get(group.leader.id) : undefined) ?? open.find(task => task.status === 'READY');
  if (!next) {
    waitUser(
      k,
      run,
      `No hay tareas listas: ${open.map(task => `${task.displayKey} (${task.status})`).join(', ')}. Pasa a READY las que estén en DRAFT; las BLOCKED esperan dependencias.`,
      null,
    );
    return null;
  }
  const remembered = memory.failures.has(next.id) ? memory.groups.get(next.id) : undefined;
  const members = (remembered ?? group?.tasks.map(task => task.id) ?? [next.id]).flatMap(id => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
  return { next, members, label: members.map(task => task.displayKey).join(', ') };
}

/** Launches the task (escalating the model on the last attempt), waits for it and accepts it or plans the retry. */
async function runTask(
  k: PilotKernel,
  run: PilotRun,
  state: LoopState,
  memory: LoopMemory,
  autonomy: FeatureAutonomy,
  { next, members, label }: NextTask,
): Promise<Step> {
  const usage = lastUsage(k, run.projectId);
  if (usage?.utilization != null && usage.utilization >= autonomy.usagePauseThreshold) {
    pause(k, run, usage, autonomy.usagePauseThreshold);
    return 'end';
  }
  const attempt = (memory.attempts.get(next.id) ?? 0) + 1;
  const escalate = attempt >= autonomy.maxAttempts && attempt > 1 && Boolean(autonomy.escalationModel);
  const model = (escalate ? autonomy.escalationModel : autonomy.executionModel) ?? undefined;
  const profileId = k.orchestrator.listProfiles(run.projectId).find(profile => profile.roleKey === 'DEVELOPER')?.id;
  if (!profileId) {
    finish(k, run, 'FAILED', 'El proyecto no tiene un perfil DEVELOPER.');
    return 'end';
  }
  log(
    k,
    run,
    escalate ? 'ESCALATED' : members.length > 1 ? 'GROUP_STARTED' : 'TASK_STARTED',
    `${label}: intento ${attempt} de ${autonomy.maxAttempts}${model ? ` con ${model}` : ''}${members.length > 1 ? ` (grupo de ${members.length} tareas en una ejecución)` : ''}.`,
    next.id,
  );
  let execution: AgentExecution;
  try {
    execution = await k.orchestrator.start({
      projectId: run.projectId,
      workItemId: next.id,
      ...(members.length > 1 ? { workItemIds: members.slice(1).map(task => task.id) } : {}),
      profileId,
      ...(model ? { model } : {}),
      ...(memory.failures.has(next.id) ? { retryContext: memory.failures.get(next.id)! } : {}),
    });
  } catch (error) {
    waitUser(k, run, `No se pudo iniciar ${label}: ${message(error)}`, next.id);
    return 'end';
  }
  state.currentExecution = execution.id;
  const final = await waitTerminal(k, execution.id, state);
  state.currentExecution = null;
  if (state.stop) return 'break';
  return afterRun(k, run, state, memory, autonomy, { next, members, label }, final, attempt);
}

/** COMPLETED is accepted with the gates; CANCELLED stops; a failure is retried with its error until the attempts run out. */
async function afterRun(
  k: PilotKernel,
  run: PilotRun,
  state: LoopState,
  memory: LoopMemory,
  autonomy: FeatureAutonomy,
  { next, members, label }: NextTask,
  final: AgentExecution,
  attempt: number,
): Promise<Step> {
  if (final.status === 'COMPLETED') {
    if (!(await acceptWithGates(k, run, final, label, autonomy, state))) return 'end';
    memory.attempts.delete(next.id);
    memory.failures.delete(next.id);
    memory.groups.delete(next.id);
    return 'continue';
  }
  if (final.status === 'CANCELLED') {
    finish(k, run, 'STOPPED', `Se canceló la ejecución de ${label}.`);
    return 'end';
  }
  // Plan S2: retrying cannot fix a package nobody approved; only the user can.
  const packages = unapprovedPackages(final);
  if (packages) {
    waitUser(
      k,
      run,
      `${label} necesita paquetes que no están aprobados: ${packages.join(', ')}. Apruébalos en Agentes y reanuda el piloto, o reanuda sin aprobarlos para que el agente busque otra forma.`,
      next.id,
      final.id,
    );
    return 'end';
  }
  memory.attempts.set(next.id, attempt);
  memory.failures.set(next.id, failureContext(k, final));
  memory.groups.set(
    next.id,
    members.map(task => task.id),
  );
  if (attempt >= autonomy.maxAttempts) {
    waitUser(
      k,
      run,
      `${label} falló ${attempt} ${attempt === 1 ? 'vez' : 'veces'}. Último motivo: ${final.resultSummary ?? 'sin detalle'}`,
      next.id,
      final.id,
    );
    return 'end';
  }
  log(
    k,
    run,
    'RETRY',
    `${label} falló (${final.resultSummary ?? 'sin detalle'}); se reintentará${members.length > 1 ? ' el grupo entero' : ''} con ese error como contexto.`,
    next.id,
    final.id,
  );
  return 'continue';
}
