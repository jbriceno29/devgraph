import type { PlanProposalPort } from '../../planning/index.js';
import type { WorkItemStatus } from '../../knowledge/index.js';
import type { AgentExecution, ApprovalDecision } from '../domain/models.js';
import { accept } from './accept-execution.js';
import { type ExecutionKernel, persistAndEmit, publishStatus } from './execution-kernel.js';
import { getPolicy, updatePolicy } from './execution-policy.js';
import { detail, setWorkItemStatus } from './execution-queries.js';
import { featureBlocker, featureIntegration } from './feature-branches.js';
import { GovernanceInterceptor } from './governance-interceptor.js';
import { integrateFeature } from './integrate-feature-branch.js';
import type { AgentAdapterPort } from './ports/agent-adapter-port.js';
import type {
  AgentContextBuilderPort,
  AgentExecutionRepositoryPort,
  ExecutionEventLogPort,
  ExecutionEventSink,
  ExecutionValidatorPort,
  GitIsolationPort,
  SkillProvisionPort,
  WorkspaceEnvironmentPort,
} from './ports/agent-execution-port.js';
import { cancel, reconcileInterrupted, shutdown } from './run-lifecycle.js';
import { requestChanges, start } from './start-execution.js';

export type { PlanProposalOutcome } from './agent-proposal.js';
export { branchSlug } from './feature-branches.js';
export { describeEnvironment, describePolicy } from './prompts/task-prompt.js';

/**
 * The runs of one project: start, supervise, review, accept and integrate. A facade kept for its callers (IPC, the
 * pilot, the composition); each action lives in its own file (A3) and works on the shared `ExecutionKernel`.
 */
export class AgentOrchestrator {
  private readonly k: ExecutionKernel;
  constructor(
    repository: AgentExecutionRepositoryPort,
    contextBuilder: AgentContextBuilderPort,
    eventLog: ExecutionEventLogPort,
    adapter: AgentAdapterPort,
    isolation: GitIsolationPort,
    validator: ExecutionValidatorPort,
    workspaceRoot: string,
    emit: ExecutionEventSink = () => undefined,
    planProposals: PlanProposalPort | null = null,
    environment: WorkspaceEnvironmentPort | null = null,
    skills: SkillProvisionPort | null = null,
  ) {
    this.k = {
      repository,
      contextBuilder,
      eventLog,
      adapter,
      isolation,
      validator,
      workspaceRoot,
      emit,
      planProposals,
      environment,
      skills,
      active: new Set(),
      accepting: new Set(),
      deadlines: new Map(),
      finishedListeners: [],
      governance: new GovernanceInterceptor(
        repository,
        adapter,
        (execution, event) => persistAndEmit(this.k, execution, event),
        execution => publishStatus(this.k, execution),
      ),
    };
  }

  listProfiles(projectId: string) {
    return this.k.repository.listProfiles(projectId).map(profile => ({
      id: profile.id,
      projectId: profile.projectId,
      roleKey: profile.roleKey,
      name: profile.name,
      defaultProviderId: profile.defaultProviderId,
      providerId: profile.provider.id,
      providerName: profile.provider.displayName,
      capabilities: profile.provider.capabilities,
      defaultModel: profile.models?.default ?? null,
      planningModel: profile.models?.planning ?? null,
      availableModels: profile.models?.available ?? [],
    }));
  }
  listExecutions(projectId: string) {
    return this.k.repository.listExecutions(projectId);
  }
  findExecution(executionId: string) {
    return this.k.repository.findExecution(executionId);
  }
  listEvents(executionId: string) {
    return this.k.repository.listEvents(executionId);
  }
  start(input: Parameters<typeof start>[1]) {
    return start(this.k, input);
  }
  /** Called once a run reaches COMPLETED, FAILED or CANCELLED (used by auto-accept). Listener errors are ignored. */
  onExecutionFinished(listener: (execution: AgentExecution) => void): void {
    this.k.finishedListeners.push(listener);
  }
  shutdown(): void {
    shutdown(this.k);
  }
  setWorkItemStatus(projectId: string, workItemId: string, to: WorkItemStatus) {
    return setWorkItemStatus(this.k, projectId, workItemId, to);
  }
  /** Subscription first; an API key (from the app's environment) is the recommended option for intensive autonomy. */
  authMode(projectId: string): 'subscription' | 'api_key' {
    const profile = this.k.repository.listProfiles(projectId).find(item => item.roleKey === 'DEVELOPER');
    return profile?.connectionConfig?.authMode === 'api_key' ? 'api_key' : 'subscription';
  }
  setAuthMode(projectId: string, mode: 'subscription' | 'api_key'): 'subscription' | 'api_key' {
    if (mode !== 'subscription' && mode !== 'api_key')
      throw new Error(`Modo de autenticación desconocido: ${String(mode)}`);
    this.k.repository.setProviderAuthMode(projectId, mode);
    return mode;
  }
  taskOutcome(workItemId: string) {
    return this.k.repository.findTaskOutcome(workItemId);
  }
  getPolicy(projectId: string) {
    return getPolicy(this.k, projectId);
  }
  updatePolicy(projectId: string, input: Parameters<typeof updatePolicy>[2]) {
    return updatePolicy(this.k, projectId, input);
  }
  detail(executionId: string) {
    return detail(this.k, executionId);
  }
  requestChanges(input: Parameters<typeof requestChanges>[1]): Promise<AgentExecution> {
    return requestChanges(this.k, input);
  }
  accept(executionId: string, options: { note?: string } = {}) {
    return accept(this.k, executionId, options);
  }
  cancel(executionId: string): Promise<AgentExecution> {
    return cancel(this.k, executionId);
  }
  reconcileInterrupted(projectId: string): AgentExecution[] {
    return reconcileInterrupted(this.k, projectId);
  }
  async resolveApproval(executionId: string, requestId: string, decision: ApprovalDecision): Promise<void> {
    return this.k.governance.resolve(executionId, requestId, decision);
  }
  featureBlocker(projectId: string, featureId: string): string | null {
    return featureBlocker(this.k, projectId, featureId);
  }
  featureIntegration(projectId: string, featureId: string) {
    return featureIntegration(this.k, projectId, featureId);
  }
  integrateFeature(projectId: string, featureId: string) {
    return integrateFeature(this.k, projectId, featureId);
  }
}
