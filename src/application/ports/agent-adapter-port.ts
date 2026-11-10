import type { AgentCapabilities, AgentEvent, AgentProviderId, ApprovalDecision } from '../../domain/agents/models.js';

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
  respondToApproval(executionId:string,requestId:string,decision:ApprovalDecision):Promise<void>;
}
