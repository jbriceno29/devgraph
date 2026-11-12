import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import { seedDefaultPolicy } from '../../execution/index.js';
import { findStackProfile } from '../../projects/index.js';
import type { ChangeOperation } from '../domain/change-set.js';

/** Profile fields replace the project's; verification commands become the allowed commands of every project policy. */
export function applyProjectProfile(
  db: SqliteDatabase,
  projectId: string,
  op: Extract<ChangeOperation, { type: 'SET_PROJECT_PROFILE' }>,
  now: string,
): void {
  db.prepare(
    'UPDATE projects SET objectives_json=?,out_of_scope_json=?,tech_stack_json=?,rules_json=?,description=COALESCE(?,description),stack_profile_id=?,updated_at=? WHERE id=?',
  ).run(
    JSON.stringify(op.objectives),
    JSON.stringify(op.outOfScope),
    JSON.stringify(op.techStack),
    JSON.stringify(op.rules),
    op.description ?? null,
    op.stackProfileId ?? null,
    now,
    projectId,
  );
  seedDefaultPolicy(db, projectId);
  db.prepare('UPDATE autonomy_policies SET allowed_commands_json=? WHERE project_id=?').run(
    JSON.stringify([...new Set(op.verificationCommands)]),
    projectId,
  );
  // The stack profile adds its root files (plan S1); an existing repository's own paths replace the defaults (REP R1).
  const extra = findStackProfile(op.stackProfileId)?.writablePaths ?? [];
  if (extra.length || op.writablePaths?.length)
    for (const row of db
      .prepare('SELECT id,writable_paths_json FROM autonomy_policies WHERE project_id=?')
      .all(projectId) as Array<{ id: string; writable_paths_json: string }>) {
      const current = op.writablePaths?.length ? op.writablePaths : (JSON.parse(row.writable_paths_json) as string[]);
      db.prepare('UPDATE autonomy_policies SET writable_paths_json=? WHERE id=?').run(
        JSON.stringify([...new Set([...current, ...extra])]),
        row.id,
      );
    }
}
