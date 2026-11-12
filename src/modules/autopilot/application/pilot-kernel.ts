import {
  type AgentExecution,
  type AgentOrchestrator,
  type ChangeReviewPort,
  coveredWorkItems,
  executionQualityFlags,
} from '../../execution/index.js';
import type { PilotEventKind, PilotRun, PilotStatus } from '../domain/models.js';
import type { PilotRepositoryPort } from './ports/pilot-port.js';

export const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
export type Usage = { utilization: number | null; window: string; resetsAt: string | null; status: string };
/** `closed`: the app is shutting down and the database may already be closed — the loop must exit without writing. */
export interface LoopState {
  stop: boolean;
  closed: boolean;
  currentExecution: string | null;
}

/** What every part of the pilot shares: its ports and the loops and resume timers this process runs (A3). */
export interface PilotKernel {
  readonly orchestrator: AgentOrchestrator;
  readonly repository: PilotRepositoryPort;
  readonly emit: (
    channel: 'pilot:updated',
    payload: { projectId: string; featureId: string; status: PilotStatus | null },
  ) => void;
  readonly options: { pollMs?: number };
  /** Plan S5: reviews runs of features with a review model before the pilot accepts them. */
  readonly reviewer: ChangeReviewPort | null;
  readonly loops: Map<string, LoopState>;
  readonly resumeTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function log(
  k: PilotKernel,
  run: PilotRun,
  kind: PilotEventKind,
  text: string,
  workItemId: string | null = null,
  executionId: string | null = null,
): void {
  k.repository.appendEvent(run.id, kind, text, workItemId, executionId);
  notify(k, run.projectId, run.featureId);
}

export function notify(k: PilotKernel, projectId: string, featureId: string, status?: PilotStatus): void {
  k.emit('pilot:updated', {
    projectId,
    featureId,
    status: status ?? k.repository.latestRun(featureId)?.status ?? null,
  });
}

export function setStatus(k: PilotKernel, run: PilotRun, status: PilotStatus, reason: string | null): void {
  k.repository.updateRun(run.id, status, reason, null);
  notify(k, run.projectId, run.featureId, status);
}

export function finish(
  k: PilotKernel,
  run: PilotRun,
  status: 'COMPLETED' | 'STOPPED' | 'FAILED',
  reason: string,
): void {
  // Idempotent: stop() may finish a run whose loop then notices and tries to finish it again.
  const current = k.repository.findRun(run.id);
  if (current && ['COMPLETED', 'STOPPED', 'FAILED'].includes(current.status)) return;
  k.repository.updateRun(run.id, status, reason, new Date().toISOString());
  log(k, run, status, reason);
}

export function waitUser(
  k: PilotKernel,
  run: PilotRun,
  reason: string,
  workItemId: string | null,
  executionId: string | null = null,
): void {
  setStatus(k, run, 'WAITING_USER', reason);
  log(k, run, 'WAITING_USER', reason, workItemId, executionId);
}

export function clearResume(k: PilotKernel, runId: string): void {
  const timer = k.resumeTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    k.resumeTimers.delete(runId);
  }
}

export function find(k: PilotKernel, executionId: string): AgentExecution | null {
  return k.orchestrator.findExecution(executionId);
}

export async function waitTerminal(k: PilotKernel, executionId: string, state: LoopState): Promise<AgentExecution> {
  const poll = k.options.pollMs ?? 500;
  for (;;) {
    const execution = find(k, executionId);
    if (execution && TERMINAL.has(execution.status)) return execution;
    if (state.stop && execution && !TERMINAL.has(execution.status))
      await k.orchestrator.cancel(executionId).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, poll));
  }
}

/** The latest usage-window report seen in any recent run of the project. */
export function lastUsage(k: PilotKernel, projectId: string): Usage | null {
  for (const execution of k.orchestrator.listExecutions(projectId).slice(0, 5)) {
    const report = [...k.orchestrator.listEvents(execution.id)]
      .reverse()
      .find(record => record.event.type === 'RATE_LIMIT_UPDATED')?.event;
    if (report?.type === 'RATE_LIMIT_UPDATED')
      return {
        utilization: report.utilization,
        window: report.window,
        resetsAt: report.resetsAt,
        status: report.status,
      };
  }
  return null;
}

export function gate(k: PilotKernel, execution: AgentExecution): { ok: true } | { ok: false; reason: string } {
  if (execution.status !== 'COMPLETED') return { ok: false, reason: 'la ejecución no terminó bien.' };
  const commands = (execution.testSummary as { commands?: Array<{ exitCode: number }> } | null)?.commands ?? [];
  if (!commands.length)
    return {
      ok: false,
      reason:
        'no hay comandos de verificación configurados en la política. Revísala y acéptala a mano, o configura comandos.',
    };
  if (commands.some(command => command.exitCode !== 0)) return { ok: false, reason: 'alguna comprobación falló.' };
  const flags = executionQualityFlags(execution);
  if (flags.length)
    return {
      ok: false,
      reason: `puede haber debilitado su propia verificación, revísala y acéptala a mano (${flags.join('; ')}).`,
    };
  return { ok: true };
}

export function latestReviewable(k: PilotKernel, projectId: string, workItemId: string): AgentExecution | null {
  return (
    k.orchestrator
      .listExecutions(projectId)
      .find(
        execution =>
          coveredWorkItems(execution).includes(workItemId) &&
          execution.status === 'COMPLETED' &&
          (!execution.reviewStatus || execution.reviewStatus === 'MERGE_CONFLICT'),
      ) ?? null
  );
}

export function failureContext(k: PilotKernel, execution: AgentExecution): string {
  const commands =
    (execution.testSummary as { commands?: Array<{ command: string; exitCode: number; output: string }> } | null)
      ?.commands ?? [];
  const failed = commands
    .filter(command => command.exitCode !== 0)
    .map(command => `$ ${command.command}\n${command.output.slice(-1500)}`);
  const denied = k.orchestrator
    .listEvents(execution.id)
    .flatMap(record =>
      record.event.type === 'ACTION_DENIED' ? [`${record.event.toolName}: ${record.event.target}`] : [],
    );
  return [
    `Motivo: ${execution.resultSummary ?? 'sin detalle'}`,
    ...failed,
    ...(denied.length ? [`Acciones denegadas por la política: ${denied.join('; ')}`] : []),
  ]
    .join('\n\n')
    .slice(0, 6000);
}
