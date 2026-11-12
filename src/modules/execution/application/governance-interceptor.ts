import type { AgentEvent, AgentExecution, ApprovalDecision } from '../domain/models.js';
import { transitionExecution } from '../domain/models.js';
import type { AgentAdapterPort } from './ports/agent-adapter-port.js';
import type { AgentExecutionRepositoryPort } from './ports/agent-execution-port.js';

interface PendingDecision {
  executionId: string;
  resolve: (approved: boolean) => void;
}
type PersistApprovalEvent = (
  execution: AgentExecution,
  event: Extract<AgentEvent, { type: 'APPROVAL_REQUIRED' }>,
) => Promise<void>;
type PublishExecution = (execution: AgentExecution) => void;

/** Pauses a capable adapter, persists the request and waits for a user/policy decision. */
export class GovernanceInterceptor {
  private readonly pending = new Map<string, PendingDecision>();
  constructor(
    private readonly repository: AgentExecutionRepositoryPort,
    private readonly adapter: AgentAdapterPort,
    private readonly persistEvent: PersistApprovalEvent,
    private readonly publishStatus: PublishExecution,
  ) {}

  async intercept(
    execution: AgentExecution,
    event: Extract<AgentEvent, { type: 'APPROVAL_REQUIRED' }>,
  ): Promise<boolean> {
    if (!this.adapter.getCapabilities().supportsApprovals)
      throw new Error('El motor pidió autorización, pero su adaptador no admite pausa y respuesta de aprobaciones.');
    const current = this.repository.findExecution(execution.id);
    if (!current || current.status !== 'RUNNING')
      throw new Error('La ejecución no está disponible para solicitar aprobación.');
    const policy = this.repository.getAutonomyPolicy(execution.projectId, execution.profileId);
    this.repository.createApprovalRequest({
      id: event.requestId,
      executionId: execution.id,
      scope: event.actionType,
      requestedAction: `${event.actionType}: ${event.target}`,
      reason: event.justification ?? 'El motor solicita autorización para una acción.',
      status: 'PENDING',
      resolvedBy: null,
      resolutionNote: null,
      requestedAt: event.timestamp,
      resolvedAt: null,
    });
    if (policy.autoApproveScopes.includes(event.actionType)) return this.autoApprove(execution, event);
    const awaiting = transitionExecution(current, 'AWAITING_APPROVAL');
    this.repository.updateExecution(awaiting);
    this.publishStatus(awaiting);
    const waiting = new Promise<boolean>(resolve =>
      this.pending.set(event.requestId, { executionId: execution.id, resolve }),
    );
    try {
      await this.persistEvent(execution, event);
    } catch (error) {
      this.pending.delete(event.requestId);
      this.repository.resolveApprovalRequest(event.requestId, {
        approved: false,
        resolvedBy: 'SYSTEM',
        note: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const approved = await waiting;
    if (!approved) return false;
    const resumed = this.repository.findExecution(execution.id);
    if (!resumed || resumed.status !== 'AWAITING_APPROVAL') return false;
    const running = transitionExecution(resumed, 'RUNNING');
    this.repository.updateExecution(running);
    this.publishStatus(running);
    return true;
  }

  /** An action the policy authorizes on its own: answered at once and recorded as approved by the policy. */
  private async autoApprove(
    execution: AgentExecution,
    event: Extract<AgentEvent, { type: 'APPROVAL_REQUIRED' }>,
  ): Promise<boolean> {
    const decision: ApprovalDecision = { approved: true, scope: 'ONCE', note: 'Autorizado por AutonomyPolicy.' };
    try {
      await this.adapter.respondToApproval(execution.id, event.requestId, decision);
    } catch (error) {
      this.repository.resolveApprovalRequest(event.requestId, {
        approved: false,
        resolvedBy: 'SYSTEM',
        note: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.repository.resolveApprovalRequest(event.requestId, {
      approved: true,
      resolvedBy: 'POLICY',
      note: decision.note!,
    });
    await this.persistEvent(execution, event);
    return true;
  }

  async resolve(executionId: string, requestId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.pending.get(requestId);
    if (!pending || pending.executionId !== executionId)
      throw new Error('Solicitud de aprobación no encontrada o perteneciente a otra ejecución.');
    const execution = this.repository.findExecution(executionId);
    if (!execution || execution.status !== 'AWAITING_APPROVAL')
      throw new Error('La ejecución ya no espera aprobación.');
    try {
      await this.adapter.respondToApproval(executionId, requestId, decision);
    } catch (error) {
      this.repository.resolveApprovalRequest(requestId, {
        approved: false,
        resolvedBy: 'SYSTEM',
        note: error instanceof Error ? error.message : String(error),
      });
      this.pending.delete(requestId);
      pending.resolve(false);
      throw error;
    }
    this.repository.resolveApprovalRequest(requestId, {
      approved: decision.approved,
      resolvedBy: 'USER',
      note: decision.approved ? (decision.note ?? '') : decision.reason,
    });
    this.pending.delete(requestId);
    pending.resolve(decision.approved);
  }

  cancel(executionId: string): void {
    for (const [requestId, pending] of this.pending)
      if (pending.executionId === executionId) {
        this.pending.delete(requestId);
        pending.resolve(false);
      }
  }
}
