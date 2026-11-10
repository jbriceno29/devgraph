import type { AgentCapabilities, AgentEvent, AgentProviderId } from '../../domain/agents/models.js';

export interface AgentRunInput {
  executionId: string;
  workingDirectory: string;
  prompt: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
}

export interface AgentAdapterPort {
  readonly providerId: AgentProviderId;
  getCapabilities(): AgentCapabilities;
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  cancel(executionId: string): Promise<void>;
}
