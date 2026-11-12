import type { AgentCapabilities, AgentEvent, AgentProviderId, ApprovalDecision } from '../../domain/models.js';

export interface AgentRunInput {
  executionId: string;
  workingDirectory: string;
  prompt: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  /** Path and command rules the engine should enforce itself; the ExecutionValidator stays the authority. */
  policy?: AgentRunPolicy;
  /** Provider connection settings (e.g. `authMode`), opaque to the application layer. */
  providerConfig?: Record<string, unknown>;
  /** Plan S4: skills the app copied into the worktree for this run (project skills folder); the engine loads only these. */
  skills?: string[];
  /** Engine session to continue (a cache of earlier work in the same feature); the workspace stays the source of truth. */
  resumeSessionId?: string;
  /** Tope de turnos del motor (exploración, herramientas); ausente o 0 = sin límite. */
  maxTurns?: number;
}

export interface AgentRunPolicy {
  writablePaths: string[];
  readonlyPaths: string[];
  deniedPaths: string[];
  allowedCommands: string[];
}

export interface AgentAdapterPort {
  readonly providerId: AgentProviderId;
  getCapabilities(): AgentCapabilities;
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  cancel(executionId: string): Promise<void>;
  respondToApproval(executionId: string, requestId: string, decision: ApprovalDecision): Promise<void>;
}
