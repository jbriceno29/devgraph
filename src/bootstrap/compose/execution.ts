import { ContextEngine } from '../../modules/context/application/context-engine.js';
import { RepositoryContextFileStore } from '../../modules/context/infrastructure/repository-context-file-store.js';
import { SqliteContextRepository } from '../../modules/context/infrastructure/sqlite-context-repository.js';
import { AgentOrchestrator } from '../../modules/execution/application/agent-orchestrator.js';
import { ExecutionEventLog } from '../../modules/execution/infrastructure/execution-event-log.js';
import { ExecutionValidator } from '../../modules/execution/infrastructure/execution-validator.js';
import { GitIsolationService } from '../../modules/execution/infrastructure/git-isolation-service.js';
import { SqliteAgentExecutionRepository } from '../../modules/execution/infrastructure/sqlite-agent-execution-repository.js';
import { SqliteChangeSetRepository } from '../../modules/knowledge/infrastructure/sqlite-change-set-repository.js';
import type { PlanProposalPort } from '../../modules/planning/application/ports/plan-proposal-port.js';
import { normalizeOperation } from '../../modules/planning/infrastructure/change-set-planning-contract.js';
import type { Container } from '../container.js';

/** Context per run and the orchestrator of each project (one per project: it tracks the runs in flight). */
export function executionServices(c: Container) {
  const services = new Map<string, AgentOrchestrator>();
  const context = (projectId: string) =>
    new ContextEngine(
      new SqliteContextRepository(c.store.openProject(projectId).database),
      new RepositoryContextFileStore(),
    );
  const build = (projectId: string) => orchestrator(c, projectId, context(projectId));
  const execution = (projectId: string) => {
    const cached = services.get(projectId);
    if (cached) return cached;
    const service = build(projectId);
    services.set(projectId, service);
    return service;
  };
  return {
    context,
    contextForSnapshot: (snapshotId: string) => {
      for (const project of c.store.listProjects()) {
        const repository = new SqliteContextRepository(c.store.openProject(project.id).database);
        if (repository.findSnapshot(snapshotId)) return new ContextEngine(repository, new RepositoryContextFileStore());
      }
      throw new Error('ContextSnapshot no encontrado.');
    },
    execution,
    executionFor: (executionId: string) => {
      for (const project of c.store.listProjects())
        if (new SqliteAgentExecutionRepository(c.store.openProject(project.id).database).findExecution(executionId))
          return execution(project.id);
      throw new Error('Ejecución no encontrada.');
    },
    close: () => {
      for (const service of services.values()) service.shutdown();
    },
  };
}

// Plan changes agents propose when closing a task: stored as AGENT_EXECUTION ChangeSets, applied only under the decision policy.
const planProposals = (c: Container, projectId: string): PlanProposalPort => ({
  normalize: operations => operations.map(operation => normalizeOperation(operation, 'El agente')),
  submit: async (id, proposal, originRefId) => {
    const changeSet = c.planning(id).submit(id, proposal, originRefId);
    return {
      changeSetId: changeSet.id,
      status: changeSet.status,
      issues: changeSet.validationIssues.filter(issue => issue.severity === 'ERROR').map(issue => issue.message),
    };
  },
  apply: async changeSetId => {
    const result = await c.planning(projectId).apply(changeSetId);
    c.emit('graph:revision_updated', { projectId: result.changeSet.projectId, revision: result.revision });
    return { revision: result.revision, resolvedIds: result.resolvedIds };
  },
  appliedAgentOperations: id =>
    new SqliteChangeSetRepository(c.store.openProject(id).database)
      .list(id)
      .filter(changeSet => changeSet.originType === 'AGENT_EXECUTION' && changeSet.status === 'APPLIED')
      .map(changeSet => changeSet.operations),
});

function orchestrator(c: Container, projectId: string, contextEngine: ContextEngine) {
  const repository = new SqliteAgentExecutionRepository(
      c.store.openProject(projectId).database,
      c.agentAdapter.providerId,
    ),
    environment = c.environment(projectId);
  return new AgentOrchestrator(
    repository,
    {
      build: async input =>
        contextEngine.preview({
          projectId: input.projectId,
          focusEntityId: input.focusEntityId,
          ...(input.extraFocusEntityIds?.length ? { extraFocusEntityIds: input.extraFocusEntityIds } : {}),
          executionId: input.executionId,
          sourceCommit: input.sourceCommit,
          maxAllowedTokens: 32_000,
          maxHops: 2,
        }),
    },
    new ExecutionEventLog(c.workspaceRoot),
    c.agentAdapter,
    new GitIsolationService(),
    new ExecutionValidator(
      c.workspaceRoot,
      (executionId, repositoryId, diffs) => repository.recordFileDiffs(executionId, repositoryId, diffs),
      environment,
    ),
    c.workspaceRoot,
    (channel, payload) => c.emit(channel, payload),
    planProposals(c, projectId),
    environment,
    c.skills(projectId),
  );
}
