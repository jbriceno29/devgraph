import type { AgentExecution, AgentEvent, AgentProfile, AgentProvider } from '../../domain/agents/models.js';
import type { WorkItem } from '../../domain/work-management/entities.js';
import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';

export interface AgentExecutionProfile extends AgentProfile {
  provider: AgentProvider;
}

export interface AgentExecutionRepositoryPort {
  listProfiles(projectId: string): AgentExecutionProfile[];
  findProfile(projectId: string, profileId: string): AgentExecutionProfile | null;
  findWorkItem(projectId: string, workItemId: string): WorkItem | null;
  getRepositoryRoot(projectId: string): string | null;
  createExecution(execution: AgentExecution): void;
  updateExecution(execution: AgentExecution): void;
  findExecution(executionId: string): AgentExecution | null;
  listExecutions(projectId: string): AgentExecution[];
  appendEvent(executionId: string, event: AgentEvent): { id: string; sequenceNo: number; createdAt: string };
  listEvents(executionId: string): Array<{ id: string; sequenceNo: number; createdAt: string; event: AgentEvent }>;
}

export interface AgentContextBuilderPort {
  build(input: { projectId: string; focusEntityId: string; repositoryRoot: string; executionId: string }): Promise<{ snapshot: ContextSnapshot; packageText: string }>;
}

export interface ExecutionEventLogPort {
  append(projectId: string, executionId: string, record: { id: string; sequenceNo: number; createdAt: string; event: AgentEvent }): Promise<void>;
}

export type ExecutionStatusEvent = { executionId: string; workItemId: string; status: AgentExecution['status'] };
export type ExecutionEventSink = (channel: 'execution:status_changed' | 'execution:event_received', payload: ExecutionStatusEvent | { executionId: string; event: AgentEvent }) => void;
