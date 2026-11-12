import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { RepositoryLocation, RepositoryLocationRepositoryPort } from '../../documents/index.js';
import type { SqliteDatabase } from '../../../platform/sqlite/database.js';

export class SqliteRepositoryLocationRepository implements RepositoryLocationRepositoryPort {
  constructor(private readonly db: SqliteDatabase) {}
  findPrimaryForProject(projectId: string): RepositoryLocation | null {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE project_id=? AND is_primary=1 ORDER BY created_at LIMIT 1')
      .get(projectId) as RepositoryRow | undefined;
    return row ? mapRepository(row) : null;
  }
  setPrimary(projectId: string, localPath: string): RepositoryLocation {
    const now = new Date().toISOString();
    return this.db
      .transaction(() => {
        const primary = this.db
          .prepare('SELECT * FROM repositories WHERE project_id=? AND is_primary=1 ORDER BY created_at LIMIT 1')
          .get(projectId) as RepositoryRow | undefined;
        this.db.prepare('UPDATE repositories SET is_primary=0 WHERE project_id=?').run(projectId);
        const existing =
          primary ??
          (this.db
            .prepare('SELECT * FROM repositories WHERE project_id=? AND local_path=?')
            .get(projectId, localPath) as RepositoryRow | undefined);
        if (existing)
          this.db
            .prepare('UPDATE repositories SET is_primary=1,name=?,local_path=? WHERE id=?')
            .run(basename(localPath) || localPath, localPath, existing.id);
        else
          this.db
            .prepare(
              `INSERT INTO repositories (id,project_id,name,local_path,git_provider,default_branch,head_commit,is_primary,created_at) VALUES (?,?,?,?,'local','main',NULL,1,?)`,
            )
            .run(randomUUID(), projectId, basename(localPath) || localPath, localPath, now);
        const row = this.db
          .prepare('SELECT * FROM repositories WHERE project_id=? AND is_primary=1')
          .get(projectId) as RepositoryRow;
        return mapRepository(row);
      })
      .immediate();
  }
  /** The project's base branch (plan GIT): features start from it and integrate into it. */
  setDefaultBranch(projectId: string, branch: string): void {
    this.db
      .prepare('UPDATE repositories SET default_branch=? WHERE project_id=? AND is_primary=1')
      .run(branch, projectId);
  }
}
interface RepositoryRow {
  id: string;
  project_id: string;
  name: string;
  local_path: string;
  default_branch: string;
  head_commit: string | null;
}
const mapRepository = (r: RepositoryRow): RepositoryLocation => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  localPath: r.local_path,
  defaultBranch: r.default_branch,
  headCommit: r.head_commit,
});
