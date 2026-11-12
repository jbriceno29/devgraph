import type { SqliteDatabase } from '../../../platform/sqlite/database.js';

/** The repository of a project and the integration branch of each feature. */
export class SqliteIntegrationBranches {
  constructor(private readonly db: SqliteDatabase) {}

  getRepositoryRoot(projectId: string): string | null {
    const row = this.db
      .prepare('SELECT local_path FROM repositories WHERE project_id=? AND is_primary=1 ORDER BY created_at LIMIT 1')
      .get(projectId) as { local_path: string } | undefined;
    return row?.local_path ?? null;
  }

  getRepositoryId(projectId: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM repositories WHERE project_id=? AND is_primary=1 ORDER BY created_at LIMIT 1')
      .get(projectId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  getIntegrationBranch(
    ownerId: string,
  ): { branchName: string; sourceBranch: string; integratedAt: string | null } | null {
    const row = this.db
      .prepare('SELECT branch_name,source_branch,integrated_at FROM feature_branches WHERE feature_id=?')
      .get(ownerId) as { branch_name: string; source_branch: string; integrated_at: string | null } | undefined;
    return row
      ? { branchName: row.branch_name, sourceBranch: row.source_branch, integratedAt: row.integrated_at ?? null }
      : null;
  }

  setFeatureIntegrated(projectId: string, branchName: string, at: string | null): void {
    this.db
      .prepare('UPDATE feature_branches SET integrated_at=? WHERE project_id=? AND branch_name=?')
      .run(at, projectId, branchName);
  }

  saveIntegrationBranch(input: {
    ownerId: string;
    projectId: string;
    repositoryId: string;
    branchName: string;
    sourceBranch: string;
  }): void {
    this.db
      .prepare(`INSERT INTO feature_branches(feature_id,project_id,repository_id,branch_name,source_branch,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(feature_id) DO UPDATE SET branch_name=excluded.branch_name,source_branch=excluded.source_branch`)
      .run(
        input.ownerId,
        input.projectId,
        input.repositoryId,
        input.branchName,
        input.sourceBranch,
        new Date().toISOString(),
      );
  }
}
