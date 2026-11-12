import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import { normalizeDecisionPolicy } from '../../autopilot/index.js';
import type { AcceptanceCriterion, WorkItem } from '../../knowledge/index.js';
import type {
  AgentExecution,
  AgentProfile,
  AgentProvider,
  AgentProviderId,
  ExecutionStatus,
} from '../domain/models.js';
import { providerDefaults } from './provider-catalog.js';

/** Rows of the execution tables and their mapping to the domain. */
export interface ProfileRow {
  id: string;
  project_id: string;
  role_key: AgentProfile['roleKey'];
  name: string;
  system_instructions: string;
  default_provider_id: string | null;
  default_policy_id: string | null;
  provider_key: AgentProviderId;
  display_name: string;
  adapter_version: string;
  capabilities_json: string;
  config_json: string | null;
}
export interface WorkItemRow {
  id: string;
  project_id: string;
  display_key: string;
  title: string;
  summary: string;
  status: string;
  parent_id: string | null;
  created_revision: number;
  updated_revision: number;
  created_at: string;
  updated_at: string;
  work_type: WorkItem['workType'];
  work_priority: WorkItem['priority'];
  scope_notes: string | null;
  acceptance_criteria_json: string;
  recommended_profile_role: WorkItem['recommendedProfileRole'];
}
export interface ExecutionRow {
  id: string;
  project_id: string;
  work_item_id: string | null;
  profile_id: string;
  provider_id: string;
  session_id: string | null;
  context_snapshot_id: string | null;
  status: ExecutionStatus;
  model_used: string | null;
  initial_commit: string;
  final_commit: string | null;
  branch_or_worktree: string | null;
  base_branch: string | null;
  execution_branch: string | null;
  revision_of: string | null;
  review_status: AgentExecution['reviewStatus'];
  review_note: string | null;
  merged_commit: string | null;
  reviewed_at: string | null;
  test_summary_json: string | null;
  result_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
}
export interface EventRow {
  id: string;
  sequence_no: number;
  created_at: string;
  payload_json: string;
}
export interface PolicyRow {
  id: string;
  project_id: string;
  name: string;
  writable_paths_json: string;
  readonly_paths_json: string;
  denied_paths_json: string;
  allowed_commands_json: string;
  auto_approve_scopes_json: string;
  require_worktree_isolation: number;
  max_execution_minutes?: number;
  max_turns?: number | null;
  decision_policy_json?: string | null;
}
export function mapProfile(row: ProfileRow): AgentProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    roleKey: row.role_key,
    name: row.name,
    systemInstructions: row.system_instructions,
    defaultProviderId: row.default_provider_id,
    defaultPolicyId: row.default_policy_id,
  };
}
export function mapProvider(row: ProfileRow): AgentProvider {
  let capabilities: AgentProvider['capabilities'] = providerDefaults(
    row.provider_key === 'opencode' ? 'claude-code' : row.provider_key,
  ).capabilities;
  try {
    capabilities = JSON.parse(row.capabilities_json) as AgentProvider['capabilities'];
  } catch {}
  return {
    id: row.default_provider_id ?? `provider:${row.provider_key}`,
    providerKey: row.provider_key,
    displayName: row.display_name,
    adapterVersion: row.adapter_version,
    capabilities,
  };
}
export function mapExecution(row: ExecutionRow, covered?: string[]): AgentExecution {
  let testSummary: unknown | null = null;
  try {
    testSummary = row.test_summary_json ? JSON.parse(row.test_summary_json) : null;
  } catch {}
  return {
    ...(covered && covered.length > 1 ? { coveredWorkItemIds: covered } : {}),
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    profileId: row.profile_id,
    providerId: row.provider_id,
    sessionId: row.session_id,
    contextSnapshotId: row.context_snapshot_id,
    status: row.status,
    modelUsed: row.model_used,
    initialCommit: row.initial_commit,
    finalCommit: row.final_commit,
    branchOrWorktree: row.branch_or_worktree,
    baseBranch: row.base_branch ?? null,
    executionBranch: row.execution_branch ?? null,
    revisionOf: row.revision_of ?? null,
    reviewStatus: row.review_status ?? null,
    reviewNote: row.review_note ?? null,
    mergedCommit: row.merged_commit ?? null,
    reviewedAt: row.reviewed_at ?? null,
    testSummary,
    resultSummary: row.result_summary,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
export function parseCriteria(json: string): AcceptanceCriterion[] {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) =>
      typeof item === 'string'
        ? [{ id: String(index + 1), description: item, verified: false }]
        : item && typeof item === 'object' && typeof (item as { description?: unknown }).description === 'string'
          ? [
              {
                id: String((item as { id?: unknown }).id ?? index + 1),
                description: (item as { description: string }).description,
                verified: Boolean((item as { verified?: unknown }).verified),
              },
            ]
          : [],
    );
  } catch {
    return [];
  }
}
export function parseArray(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
export function toRow(execution: AgentExecution): Record<string, unknown> {
  return {
    ...execution,
    executionBranch: execution.executionBranch ?? null,
    revisionOf: execution.revisionOf ?? null,
    reviewStatus: execution.reviewStatus ?? null,
    reviewNote: execution.reviewNote ?? null,
    mergedCommit: execution.mergedCommit ?? null,
    reviewedAt: execution.reviewedAt ?? null,
    testSummary: execution.testSummary === null ? null : JSON.stringify(execution.testSummary),
  };
}
export function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const defaultPolicyId = (projectId: string) => `${projectId}:policy:default`;
/** Inserts the project's default execution policy when missing (kept as is when it exists). */
export function seedDefaultPolicy(db: SqliteDatabase, projectId: string): void {
  db.prepare(`INSERT INTO autonomy_policies(id,project_id,name,writable_paths_json,readonly_paths_json,denied_paths_json,allowed_commands_json,auto_approve_scopes_json,require_worktree_isolation)
    VALUES(?,?,?,'["src/**","tests/**","docs/**","node_modules/**","dist/**","target/**","coverage/**"]','["docs/architecture/ADR/**"]','[".env*",".git/config"]','[]','[]',1) ON CONFLICT(id) DO NOTHING`).run(
    defaultPolicyId(projectId),
    projectId,
    'Default isolated execution policy',
  );
}

/** A stored policy that no longer parses falls back to the defaults rather than blocking every run. */
export function readDecisionPolicy(json: string | null | undefined) {
  try {
    return normalizeDecisionPolicy(json ? JSON.parse(json) : null);
  } catch {
    return normalizeDecisionPolicy(null);
  }
}
