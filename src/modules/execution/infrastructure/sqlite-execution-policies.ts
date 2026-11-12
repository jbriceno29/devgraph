import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import type { AutonomyPolicy } from '../domain/governance.js';
import { type PolicyRow, parseArray, readDecisionPolicy } from './sqlite-execution-rows.js';

/** The execution policy of a profile (paths, checks, limits and decision policy). */
export class SqliteExecutionPolicies {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly profiles: { ensureDefaults(projectId: string): void },
  ) {}

  getAutonomyPolicy(projectId: string, profileId: string): AutonomyPolicy {
    this.profiles.ensureDefaults(projectId);
    const row = this.db
      .prepare(
        `SELECT a.* FROM autonomy_policies a JOIN agent_profiles p ON p.default_policy_id=a.id WHERE p.project_id=? AND p.id=?`,
      )
      .get(projectId, profileId) as PolicyRow | undefined;
    if (!row) throw new Error('No hay una política de autonomía asignada al perfil.');
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      writablePaths: parseArray(row.writable_paths_json),
      readonlyPaths: parseArray(row.readonly_paths_json),
      deniedPaths: parseArray(row.denied_paths_json),
      allowedCommands: parseArray(row.allowed_commands_json),
      autoApproveScopes: parseArray(row.auto_approve_scopes_json),
      requireWorktreeIsolation: Boolean(row.require_worktree_isolation),
      maxExecutionMinutes: row.max_execution_minutes ?? 30,
      maxTurns: row.max_turns ?? 0,
      decisionPolicy: readDecisionPolicy(row.decision_policy_json),
    };
  }

  updateAutonomyPolicy(
    policyId: string,
    fields: Pick<
      AutonomyPolicy,
      | 'writablePaths'
      | 'readonlyPaths'
      | 'deniedPaths'
      | 'allowedCommands'
      | 'maxExecutionMinutes'
      | 'maxTurns'
      | 'decisionPolicy'
    >,
  ): void {
    const result = this.db
      .prepare(
        'UPDATE autonomy_policies SET writable_paths_json=?,readonly_paths_json=?,denied_paths_json=?,allowed_commands_json=?,max_execution_minutes=?,max_turns=?,decision_policy_json=? WHERE id=?',
      )
      .run(
        JSON.stringify(fields.writablePaths),
        JSON.stringify(fields.readonlyPaths),
        JSON.stringify(fields.deniedPaths),
        JSON.stringify(fields.allowedCommands),
        fields.maxExecutionMinutes,
        fields.maxTurns,
        JSON.stringify(fields.decisionPolicy),
        policyId,
      );
    if (result.changes !== 1) throw new Error('La política de autonomía no existe.');
  }
}
