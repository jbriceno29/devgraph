import type { AgentProviderId } from '../domain/models.js';
import type { AgentExecutionRepositoryPort as Port } from '../application/ports/agent-execution-port.js';
import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import { SqliteExecutionApprovals } from './sqlite-execution-approvals.js';
import { SqliteIntegrationBranches } from './sqlite-execution-branches.js';
import { SqliteExecutionRecords } from './sqlite-execution-executions.js';
import { SqliteTaskOutcomes } from './sqlite-execution-outcomes.js';
import { SqliteExecutionPolicies } from './sqlite-execution-policies.js';
import { SqliteExecutionProfiles } from './sqlite-execution-profiles.js';
import { SqliteExecutionWorkItems } from './sqlite-execution-work-items.js';

export { defaultPolicyId, seedDefaultPolicy } from './sqlite-execution-rows.js';

/**
 * The execution flow's view of a project's workspace database. A facade (A3): each concern lives in its own
 * `sqlite-execution-*.ts` repository and this class only forwards to it.
 */
export class SqliteAgentExecutionRepository implements Port {
  private readonly profiles: SqliteExecutionProfiles;
  private readonly policies: SqliteExecutionPolicies;
  private readonly approvals: SqliteExecutionApprovals;
  private readonly workItems: SqliteExecutionWorkItems;
  private readonly branches: SqliteIntegrationBranches;
  private readonly outcomes: SqliteTaskOutcomes;
  private readonly records: SqliteExecutionRecords;
  /** `providerKey` is the adapter wired into this process; its provider and DEVELOPER profile are seeded per project. */
  constructor(db: SqliteDatabase, providerKey: AgentProviderId = 'claude-code') {
    this.profiles = new SqliteExecutionProfiles(db, providerKey);
    this.policies = new SqliteExecutionPolicies(db, this.profiles);
    this.approvals = new SqliteExecutionApprovals(db);
    this.workItems = new SqliteExecutionWorkItems(db);
    this.branches = new SqliteIntegrationBranches(db);
    this.outcomes = new SqliteTaskOutcomes(db);
    this.records = new SqliteExecutionRecords(db);
  }

  appendEvent(...args: Parameters<Port['appendEvent']>) {
    return this.records.appendEvent(...args);
  }
  createApprovalRequest(...args: Parameters<Port['createApprovalRequest']>) {
    return this.approvals.createApprovalRequest(...args);
  }
  createExecution(...args: Parameters<Port['createExecution']>) {
    return this.records.createExecution(...args);
  }
  externalSessionId(...args: Parameters<Port['externalSessionId']>) {
    return this.records.externalSessionId(...args);
  }
  findExecution(...args: Parameters<Port['findExecution']>) {
    return this.records.findExecution(...args);
  }
  findFeatureFor(...args: Parameters<Port['findFeatureFor']>) {
    return this.workItems.findFeatureFor(...args);
  }
  findProfile(...args: Parameters<Port['findProfile']>) {
    return this.profiles.findProfile(...args);
  }
  findTaskOutcome(...args: Parameters<Port['findTaskOutcome']>) {
    return this.outcomes.findTaskOutcome(...args);
  }
  findWorkItem(...args: Parameters<Port['findWorkItem']>) {
    return this.workItems.findWorkItem(...args);
  }
  getAutonomyPolicy(...args: Parameters<Port['getAutonomyPolicy']>) {
    return this.policies.getAutonomyPolicy(...args);
  }
  getIntegrationBranch(...args: Parameters<Port['getIntegrationBranch']>) {
    return this.branches.getIntegrationBranch(...args);
  }
  getRepositoryId(...args: Parameters<Port['getRepositoryId']>) {
    return this.branches.getRepositoryId(...args);
  }
  getRepositoryRoot(...args: Parameters<Port['getRepositoryRoot']>) {
    return this.branches.getRepositoryRoot(...args);
  }
  listDependencies(...args: Parameters<Port['listDependencies']>) {
    return this.workItems.listDependencies(...args);
  }
  listDependents(...args: Parameters<Port['listDependents']>) {
    return this.workItems.listDependents(...args);
  }
  listDocumentPaths(...args: Parameters<Port['listDocumentPaths']>) {
    return this.workItems.listDocumentPaths(...args);
  }
  listEvents(...args: Parameters<Port['listEvents']>) {
    return this.records.listEvents(...args);
  }
  listExecutions(...args: Parameters<Port['listExecutions']>) {
    return this.records.listExecutions(...args);
  }
  listFeatureDependencies(...args: Parameters<Port['listFeatureDependencies']>) {
    return this.workItems.listFeatureDependencies(...args);
  }
  listFeatureTasks(...args: Parameters<Port['listFeatureTasks']>) {
    return this.workItems.listFeatureTasks(...args);
  }
  listFileDiffs(...args: Parameters<Port['listFileDiffs']>) {
    return this.records.listFileDiffs(...args);
  }
  listProfiles(...args: Parameters<Port['listProfiles']>) {
    return this.profiles.listProfiles(...args);
  }
  recordFileDiffs(...args: Parameters<Port['recordFileDiffs']>) {
    return this.records.recordFileDiffs(...args);
  }
  recordTaskOutcome(...args: Parameters<Port['recordTaskOutcome']>) {
    return this.outcomes.recordTaskOutcome(...args);
  }
  rejectPendingApprovals(...args: Parameters<Port['rejectPendingApprovals']>) {
    return this.approvals.rejectPendingApprovals(...args);
  }
  resolveApprovalRequest(...args: Parameters<Port['resolveApprovalRequest']>) {
    return this.approvals.resolveApprovalRequest(...args);
  }
  saveIntegrationBranch(...args: Parameters<Port['saveIntegrationBranch']>) {
    return this.branches.saveIntegrationBranch(...args);
  }
  setFeatureIntegrated(...args: Parameters<NonNullable<Port['setFeatureIntegrated']>>) {
    return this.branches.setFeatureIntegrated(...args);
  }
  setProviderAuthMode(...args: Parameters<Port['setProviderAuthMode']>) {
    return this.profiles.setProviderAuthMode(...args);
  }
  transitionWorkItem(...args: Parameters<Port['transitionWorkItem']>) {
    return this.workItems.transitionWorkItem(...args);
  }
  updateAutonomyPolicy(...args: Parameters<Port['updateAutonomyPolicy']>) {
    return this.policies.updateAutonomyPolicy(...args);
  }
  updateExecution(...args: Parameters<Port['updateExecution']>) {
    return this.records.updateExecution(...args);
  }
}
