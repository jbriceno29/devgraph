import { existsSync, readFileSync } from 'node:fs';
import type { GetFeatureChecks } from './application/get-feature-checks.js';
import type { RunFeatureChecks } from './application/run-feature-checks.js';
import { checksOf } from './domain/check-summary.js';
import { join } from 'node:path';
import type {
  AgentExecutionDto,
  ExecutionPolicyDto,
  RequestExecutionChangesInput,
  StartAgentExecutionInput,
} from '../../shared/contracts/agent-view.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { WorkItemStatus } from '../knowledge/index.js';
import type { AgentOrchestrator } from './application/agent-orchestrator.js';
import type { CheckFeatureConflicts } from './application/check-feature-conflicts.js';
import type { IntegrateFeature } from './application/integrate-feature.js';
import type { ResolveFeatureConflicts } from './application/resolve-feature-conflicts.js';
import { coveredWorkItems, type AgentExecution, type ApprovalDecision } from './domain/models.js';
import { readableResultSummary } from './domain/result-summary.js';
import { executionQualityFlags, unapprovedPackages } from './domain/run-summary.js';

export interface ExecutionIpcDeps {
  workspaceRoot: string;
  execution(projectId: string): AgentOrchestrator;
  executionFor(executionId: string): AgentOrchestrator;
  emit(channel: string, payload: unknown): void;
  featureConflicts: FeatureConflictUseCases;
}

/** Plan UX, F0b: conflicts of a feature with its base branch and with other features. */
export interface FeatureConflictUseCases {
  check: CheckFeatureConflicts;
  integrate: IntegrateFeature;
  resolve: ResolveFeatureConflicts;
  /** Plan C6: the integration checks (a build) of a finished feature. */
  checks: GetFeatureChecks;
  runChecks: RunFeatureChecks;
}

/** Runs of the agent (start, review, accept, approvals), the execution policy, the engine's auth and feature integration. */
export function executionHandlers(d: ExecutionIpcDeps): IpcHandlers {
  const of = (projectId: unknown) => d.execution(text(projectId));
  const run = (executionId: unknown) => d.executionFor(text(executionId));
  return {
    'agent:list_profiles': ([id]) => of(id).listProfiles(text(id)),
    'execution:list': ([id]) => of(id).listExecutions(text(id)).map(toAgentExecutionDto),
    'execution:list_events': ([id]) => run(id).listEvents(text(id)),
    'execution:start': serial(async ([raw]) => {
      const input = raw as StartAgentExecutionInput;
      return toAgentExecutionDto(await d.execution(input.projectId).start(input));
    }),
    'execution:cancel': serial(async ([id]) => toAgentExecutionDto(await run(id).cancel(text(id)))),
    'execution:accept': serial(async ([id]) => {
      const result = await run(id).accept(text(id));
      return { ...result, execution: toAgentExecutionDto(result.execution) };
    }),
    'execution:request_changes': serial(async ([raw]) => {
      const input = raw as RequestExecutionChangesInput;
      return toAgentExecutionDto(await run(input.executionId).requestChanges(input));
    }),
    'execution:get_detail': ([id]) => {
      const detail = run(id).detail(text(id));
      const logPath = join(
        d.workspaceRoot,
        'projects',
        detail.execution.projectId,
        'executions',
        detail.execution.id,
        'test-output.log',
      );
      const testLog = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-200_000) : null;
      return { ...detail, execution: toAgentExecutionDto(detail.execution), testLog };
    },
    'execution:resolve_approval': serial(async ([raw]) => {
      const input = raw as { executionId: string; requestId: string; decision: ApprovalDecision };
      await run(input.executionId).resolveApproval(input.executionId, input.requestId, input.decision);
      return { resolved: true };
    }),
    ...projectHandlers(d),
  };
}

/** What a project's runs follow: task status by hand, execution policy, engine auth and feature integration. */
function projectHandlers(d: ExecutionIpcDeps): IpcHandlers {
  const of = (projectId: unknown) => d.execution(text(projectId));
  return {
    'workitem:set_status': serial(([id, workItemId, status]) =>
      of(id).setWorkItemStatus(text(id), text(workItemId), text(status) as WorkItemStatus),
    ),
    'policy:get': ([id]) => of(id).getPolicy(text(id)),
    'policy:update': serial(([id, raw]) => {
      const policy = raw as ExecutionPolicyDto;
      return of(id).updatePolicy(text(id), {
        writablePaths: policy?.writablePaths ?? [],
        readonlyPaths: policy?.readonlyPaths ?? [],
        deniedPaths: policy?.deniedPaths ?? [],
        allowedCommands: policy?.allowedCommands ?? [],
        ...(typeof policy?.maxExecutionMinutes === 'number' ? { maxExecutionMinutes: policy.maxExecutionMinutes } : {}),
        ...(typeof policy?.maxTurns === 'number' || policy?.maxTurns === null ? { maxTurns: policy.maxTurns } : {}),
        ...(policy?.decisionPolicy !== undefined ? { decisionPolicy: policy.decisionPolicy } : {}),
      });
    }),
    'provider:get_auth': ([id]) => ({
      authMode: of(id).authMode(text(id)),
      apiKeyAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    }),
    'provider:set_auth_mode': serial(([id, mode]) => ({
      authMode: of(id).setAuthMode(text(id), mode as 'subscription' | 'api_key'),
    })),
    // `pilot:updated` refreshes the feature panel and the activity (the shell's next step reads `integrations`).
    'feature:integrate': serial(async ([id, featureId]) => {
      const result = await d.featureConflicts.integrate.execute(text(id), text(featureId));
      d.emit('pilot:updated', { projectId: text(id), featureId: text(featureId), status: null });
      return result;
    }),
    'feature:check_conflicts': ([id, featureId]) => d.featureConflicts.check.execute(text(id), text(featureId)),
    'feature:checks': ([id, featureId]) => d.featureConflicts.checks.execute(text(id), text(featureId)),
    'feature:run_checks': serial(([id, featureId]) => d.featureConflicts.runChecks.execute(text(id), text(featureId))),
    'feature:resolve_conflicts': serial(async ([id, featureId]) => {
      const result = await d.featureConflicts.resolve.execute(text(id), text(featureId));
      d.emit('pilot:updated', { projectId: text(id), featureId: text(featureId), status: null });
      return result;
    }),
  };
}

export function toAgentExecutionDto(execution: AgentExecution): AgentExecutionDto {
  const pending = unapprovedPackages(execution),
    flags = executionQualityFlags(execution),
    checks = checksOf(execution.testSummary);
  return {
    id: execution.id,
    projectId: execution.projectId,
    workItemId: execution.workItemId,
    profileId: execution.profileId,
    providerId: execution.providerId,
    sessionId: execution.sessionId,
    contextSnapshotId: execution.contextSnapshotId,
    status: execution.status,
    modelUsed: execution.modelUsed,
    initialCommit: execution.initialCommit,
    finalCommit: execution.finalCommit,
    branchOrWorktree: execution.branchOrWorktree,
    baseBranch: execution.baseBranch,
    executionBranch: execution.executionBranch ?? null,
    revisionOf: execution.revisionOf ?? null,
    reviewStatus: execution.reviewStatus ?? null,
    reviewNote: execution.reviewNote ?? null,
    mergedCommit: execution.mergedCommit ?? null,
    reviewedAt: execution.reviewedAt ?? null,
    resultSummary: readableResultSummary(execution.resultSummary),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    coveredWorkItemIds: coveredWorkItems(execution),
    ...(pending ? { pendingPackages: pending } : {}),
    ...(flags.length ? { qualityFlags: flags } : {}),
    ...(checks.length ? { checks } : {}),
  };
}
