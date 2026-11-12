import type { AgentExecution, PlanProposalOutcome } from '../../execution/index.js';
import type { FeatureAutonomy, PilotRun } from '../domain/models.js';
import {
  type LoopState,
  type PilotKernel,
  gate,
  log,
  message,
  notify,
  waitTerminal,
  waitUser,
} from './pilot-kernel.js';

/** Accepts a completed run when the gates pass; otherwise hands it to the user. Returns whether the loop may go on. */
export async function acceptWithGates(
  k: PilotKernel,
  run: PilotRun,
  completed: AgentExecution,
  key: string,
  autonomy?: FeatureAutonomy,
  state?: LoopState,
): Promise<boolean> {
  let execution = completed;
  // Plan S5: with a review model, a second model checks the run against its criteria; a rejection becomes a revision
  // of the same run with the findings as feedback, up to the feature's attempts, and then the user decides.
  for (let round = 1; ; round += 1) {
    const outcome = await reviewRound(k, run, execution, key, round, autonomy, state);
    if (outcome === 'stop') return false;
    if (outcome === 'accept') break;
    execution = outcome;
  }
  return acceptRun(k, run, execution, key);
}

type Hand = (reason: string, executionId?: string) => void;

/** One round: the gates, then the review model if any. `accept`, `stop` (handed to the user) or the revised run. */
async function reviewRound(
  k: PilotKernel,
  run: PilotRun,
  execution: AgentExecution,
  key: string,
  round: number,
  autonomy: FeatureAutonomy | undefined,
  state: LoopState | undefined,
): Promise<'accept' | 'stop' | AgentExecution> {
  const hand: Hand = (reason, executionId = execution.id) =>
    waitUser(k, run, reason, execution.workItemId, executionId);
  const verdictGate = gate(k, execution);
  if (!verdictGate.ok) {
    hand(`${key} terminó pero no se acepta sola: ${verdictGate.reason}`);
    return 'stop';
  }
  if (!autonomy?.reviewModel || !k.reviewer) return 'accept';
  let verdict;
  try {
    verdict = await k.reviewer.review({
      projectId: run.projectId,
      executionId: execution.id,
      model: autonomy.reviewModel,
    });
  } catch (error) {
    hand(
      `No se pudo revisar ${key} con ${autonomy.reviewModel}: ${message(error)}. Revísala y acéptala a mano, o reanuda el piloto.`,
    );
    return 'stop';
  }
  if (state?.stop || state?.closed) return 'stop';
  if (verdict.approved) {
    log(
      k,
      run,
      'REVIEW_APPROVED',
      `${key}: la revisión con ${autonomy.reviewModel} la aprueba.`,
      execution.workItemId,
      execution.id,
    );
    return 'accept';
  }
  const findings = verdict.findings.map(finding => `- ${finding}`).join('\n');
  log(
    k,
    run,
    'REVIEW_REJECTED',
    `${key}: la revisión con ${autonomy.reviewModel} la rechaza (${round} de ${autonomy.maxAttempts}).\n${findings}`,
    execution.workItemId,
    execution.id,
  );
  if (round >= autonomy.maxAttempts) {
    hand(`${key} no pasó la revisión tras ${round} ${round === 1 ? 'intento' : 'intentos'}. Hallazgos:\n${findings}`);
    return 'stop';
  }
  return revise(k, execution, key, findings, autonomy, state, hand);
}

/** A revision of the run with the review's findings as feedback, waited for; `stop` when it cannot go on. */
async function revise(
  k: PilotKernel,
  execution: AgentExecution,
  key: string,
  findings: string,
  autonomy: FeatureAutonomy,
  state: LoopState | undefined,
  hand: Hand,
): Promise<'stop' | AgentExecution> {
  let revision: AgentExecution;
  try {
    revision = await k.orchestrator.requestChanges({
      executionId: execution.id,
      feedback: `La revisión independiente encontró problemas; corrígelos sin romper lo demás:\n${findings}`,
      ...(autonomy.executionModel ? { model: autonomy.executionModel } : {}),
    });
  } catch (error) {
    hand(`No se pudieron pedir los ajustes de la revisión para ${key}: ${message(error)}`);
    return 'stop';
  }
  if (!state) return 'stop';
  state.currentExecution = revision.id;
  const final = await waitTerminal(k, revision.id, state);
  state.currentExecution = null;
  if (state.stop || state.closed) return 'stop';
  if (final.status !== 'COMPLETED') {
    hand(
      `El ajuste de ${key} pedido por la revisión no terminó bien: ${final.resultSummary ?? final.status}`,
      final.id,
    );
    return 'stop';
  }
  return final;
}

/** Integrates the run into the feature branch and logs it; then the agent's plan proposal, if any. */
async function acceptRun(k: PilotKernel, run: PilotRun, execution: AgentExecution, key: string): Promise<boolean> {
  const result = await k.orchestrator.accept(execution.id, {
    note: 'Aceptada por el piloto automático: auditoría y comprobaciones en verde.',
  });
  if (!result.merged) {
    waitUser(
      k,
      run,
      `No se pudo integrar ${key}: ${result.conflict?.detail ?? 'conflicto'}${result.conflict?.files.length ? ` (${result.conflict.files.join(', ')})` : ''}`,
      execution.workItemId,
      execution.id,
    );
    return false;
  }
  log(
    k,
    run,
    'TASK_ACCEPTED',
    `${key} aceptada e integrada en ${execution.baseBranch} (${result.execution.mergedCommit?.slice(0, 8)}).`,
    execution.workItemId,
    execution.id,
  );
  return handleProposal(k, run, result.proposal ?? null, key, execution);
}

/**
 * The agent may propose plan changes when closing a task (the orchestrator already applied or stored them per the
 * project's decision policy). APPLIED: the new tasks are in the graph and the loop picks them up on its next pass.
 * PENDING: the user decides in Planning — the pilot waits; on resume it goes on with whatever the graph holds then,
 * resolved or not. INVALID: logged only; a bad proposal never stops the execution.
 */
export function handleProposal(
  k: PilotKernel,
  run: PilotRun,
  proposal: PlanProposalOutcome | null,
  key: string,
  execution: AgentExecution,
): boolean {
  if (!proposal) return true;
  const reasons = proposal.reasons
    .map(reason => reason.trim().replace(/\.+$/, ''))
    .filter(Boolean)
    .join('; ');
  if (proposal.outcome === 'APPLIED') {
    log(
      k,
      run,
      'PLAN_CHANGED',
      `Plan modificado al cerrar ${key}: ${proposal.title}.${reasons ? ` ${reasons}.` : ''} Las tareas nuevas entran en el recorrido.`,
      execution.workItemId,
      execution.id,
    );
    return true;
  }
  if (proposal.outcome === 'INVALID') {
    log(
      k,
      run,
      'PLAN_PROPOSAL',
      `Propuesta de ${key} descartada (${proposal.title}): ${reasons || 'inválida'}. El piloto continúa.`,
      execution.workItemId,
      execution.id,
    );
    return true;
  }
  log(
    k,
    run,
    'PLAN_PROPOSAL',
    `Propuesta de ${key} pendiente de tu decisión: ${proposal.title}.`,
    execution.workItemId,
    execution.id,
  );
  waitUser(
    k,
    run,
    `El agente propone cambios al plan que requieren tu decisión: ${proposal.title}.${reasons ? ` ${reasons}.` : ''} Revísalos en Planificación y reanuda el piloto.`,
    execution.workItemId,
    execution.id,
  );
  return false;
}

export async function autoAccept(k: PilotKernel, execution: AgentExecution): Promise<void> {
  if (execution.status !== 'COMPLETED' || !execution.workItemId) return;
  try {
    const featureId = k.repository.featureOf(execution.projectId, execution.workItemId);
    if (!featureId || k.repository.getAutonomy(execution.projectId, featureId).level !== 'AUTO_ACCEPT') return;
    if (!gate(k, execution).ok) return;
    // A plan proposal was already applied or stored by the orchestrator per the project's policy; without a pilot run
    // there is no log to write and nothing to stop: the notification refreshes the views (Planning shows pending ones).
    await k.orchestrator.accept(execution.id, {
      note: 'Aceptada automáticamente (nivel auto-aceptar): auditoría y comprobaciones en verde.',
    });
    notify(k, execution.projectId, featureId);
  } catch {
    /* stays IN_REVIEW for the user */
  }
}
