import type { AgentExecution } from '../../domain/agents/models.js';
import { coveredWorkItems } from '../../domain/agents/models.js';
import type { PilotRepositoryPort } from '../ports/pilot-port.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';

export interface ExecutionMetrics {
  executionId: string;
  status: string;
  reviewStatus: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  durationMs: number | null;
  filesChanged: number;
  additions: number;
  deletions: number;
  deniedActions: number;
  policyViolations: number;
  checksRun: number;
  checksPassed: boolean | null;
  revisionOf: string | null;
  autoAccepted: boolean;
}
export interface TaskMetrics {
  workItemId: string;
  displayKey: string;
  title: string;
  status: string;
  executions: ExecutionMetrics[];
  attempts: number;
  acceptedOnFirstAttempt: boolean;
  interventions: number;
}
export interface FeatureReport {
  featureId: string;
  generatedAt: string;
  tasks: TaskMetrics[];
  totals: {
    tasks: number;
    done: number;
    executions: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    deniedActions: number;
    policyViolations: number;
    acceptedOnFirstAttempt: number;
    acceptedWithoutHuman: number;
    interventions: number;
    pilotWaits: number;
  };
}

/**
 * Stage 5: measures what the workspace costs and saves, from data already recorded — engine usage, timings, diffs,
 * denied actions, checks, reviews and autopilot decisions. "Interventions" approximates the user's orchestration time:
 * every manual acceptance, change request and autopilot stop that needed the user.
 */
export class FeatureMetrics {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly pilots: PilotRepositoryPort,
  ) {}

  report(projectId: string, featureId: string): FeatureReport {
    const executions = this.orchestrator.listExecutions(projectId);
    const pilotWaitsByTask = new Map<string, number>();
    let pilotWaits = 0;
    for (const run of this.pilots
      .listRuns(projectId, ['RUNNING', 'PAUSED', 'WAITING_USER', 'COMPLETED', 'STOPPED', 'FAILED'])
      .filter(run => run.featureId === featureId)) {
      for (const event of this.pilots.listEvents(run.id, 10_000)) {
        if (event.kind !== 'WAITING_USER') continue;
        pilotWaits += 1;
        if (event.workItemId) pilotWaitsByTask.set(event.workItemId, (pilotWaitsByTask.get(event.workItemId) ?? 0) + 1);
      }
    }
    const tasks = this.pilots.listFeatureTasks(projectId, featureId).map(task => {
      const runs = executions
        .filter(execution => coveredWorkItems(execution).includes(task.id))
        .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
      const metrics = runs.map(run => this.metrics(run));
      const first = metrics[0];
      const acceptedOnFirstAttempt = metrics.length === 1 && first?.reviewStatus === 'ACCEPTED';
      const manual = metrics.filter(
        item => item.reviewStatus === 'CHANGES_REQUESTED' || (item.reviewStatus === 'ACCEPTED' && !item.autoAccepted),
      ).length;
      return {
        workItemId: task.id,
        displayKey: task.displayKey,
        title: task.title,
        status: task.status,
        executions: metrics,
        attempts: metrics.length,
        acceptedOnFirstAttempt,
        interventions: manual + (pilotWaitsByTask.get(task.id) ?? 0),
      };
    });
    // A grouped execution appears under each task it covers; the totals count it once.
    const all = [...new Map(tasks.flatMap(task => task.executions).map(item => [item.executionId, item])).values()];
    const sum = (pick: (item: ExecutionMetrics) => number) => all.reduce((total, item) => total + pick(item), 0);
    return {
      featureId,
      generatedAt: new Date().toISOString(),
      tasks,
      totals: {
        tasks: tasks.length,
        done: tasks.filter(task => task.status === 'DONE').length,
        executions: all.length,
        inputTokens: sum(item => item.inputTokens),
        outputTokens: sum(item => item.outputTokens),
        durationMs: sum(item => item.durationMs ?? 0),
        deniedActions: sum(item => item.deniedActions),
        policyViolations: sum(item => item.policyViolations),
        acceptedOnFirstAttempt: tasks.filter(task => task.acceptedOnFirstAttempt).length,
        acceptedWithoutHuman: all.filter(item => item.reviewStatus === 'ACCEPTED' && item.autoAccepted).length,
        interventions:
          tasks.reduce((total, task) => total + task.interventions, 0) +
          (pilotWaits - [...pilotWaitsByTask.values()].reduce((a, b) => a + b, 0)),
        pilotWaits,
      },
    };
  }

  private metrics(execution: AgentExecution): ExecutionMetrics {
    const events = this.orchestrator.listEvents(execution.id);
    // A failed run (e.g. the turn limit) also spent tokens: take the usage of the last terminal event that reports it.
    const terminal = [...events]
      .reverse()
      .find(
        record =>
          (record.event.type === 'EXECUTION_FINISHED' || record.event.type === 'EXECUTION_FAILED') &&
          record.event.usage,
      )?.event;
    const usage =
      terminal?.type === 'EXECUTION_FINISHED' || terminal?.type === 'EXECUTION_FAILED' ? terminal.usage : undefined;
    const summary = execution.testSummary as { commands?: Array<{ exitCode: number }>; violations?: string[] } | null;
    const diffs = this.orchestrator.detail(execution.id).files;
    return {
      executionId: execution.id,
      status: execution.status,
      reviewStatus: execution.reviewStatus ?? null,
      model: execution.modelUsed,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      uncachedInputTokens: (usage?.inputTokens ?? 0) - (usage?.cacheReadTokens ?? 0),
      durationMs:
        execution.startedAt && execution.completedAt
          ? Date.parse(execution.completedAt) - Date.parse(execution.startedAt)
          : null,
      filesChanged: diffs.length,
      additions: diffs.reduce((total, diff) => total + diff.additions, 0),
      deletions: diffs.reduce((total, diff) => total + diff.deletions, 0),
      deniedActions: events.filter(record => record.event.type === 'ACTION_DENIED').length,
      policyViolations: summary?.violations?.length ?? 0,
      checksRun: summary?.commands?.length ?? 0,
      checksPassed: summary?.commands?.length ? summary.commands.every(command => command.exitCode === 0) : null,
      revisionOf: execution.revisionOf ?? null,
      autoAccepted: execution.reviewStatus === 'ACCEPTED' && /piloto|auto-aceptar/i.test(execution.reviewNote ?? ''),
    };
  }
}

/** Markdown rendering of a feature report, for the workspace's reports folder. */
export function renderFeatureReport(report: FeatureReport, featureLabel: string): string {
  const t = report.totals;
  const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
  const lines = [
    `# Informe de la feature ${featureLabel}`,
    '',
    `Generado: ${report.generatedAt}`,
    '',
    '| Métrica | Valor |',
    '| :--- | ---: |',
    `| Tareas cerradas | ${t.done} de ${t.tasks} |`,
    `| Ejecuciones | ${t.executions} |`,
    `| Aceptadas al primer intento | ${t.acceptedOnFirstAttempt} |`,
    `| Aceptadas sin intervención | ${t.acceptedWithoutHuman} |`,
    `| Intervenciones humanas | ${t.interventions} (esperas del piloto: ${t.pilotWaits}) |`,
    `| Tokens de entrada / salida | ${t.inputTokens.toLocaleString('es')} / ${t.outputTokens.toLocaleString('es')} |`,
    `| Tiempo de ejecución | ${minutes(t.durationMs)} |`,
    `| Acciones denegadas | ${t.deniedActions} |`,
    `| Violaciones de política | ${t.policyViolations} |`,
    '',
    '| Tarea | Estado | Intentos | Tokens (entrada/salida) | Tiempo | Archivos | Pruebas |',
    '| :--- | :--- | ---: | ---: | ---: | ---: | :--- |',
    ...report.tasks.map(task => {
      const input = task.executions.reduce((total, item) => total + item.inputTokens, 0),
        output = task.executions.reduce((total, item) => total + item.outputTokens, 0);
      const time = task.executions.reduce((total, item) => total + (item.durationMs ?? 0), 0),
        last = task.executions.at(-1);
      return `| ${task.displayKey} ${task.title} | ${task.status} | ${task.attempts} | ${input.toLocaleString('es')} / ${output.toLocaleString('es')} | ${minutes(time)} | ${last?.filesChanged ?? 0} | ${last?.checksPassed === null || !last ? '—' : last.checksPassed ? 'OK' : 'fallaron'} |`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}
