import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type SqliteDatabase = Database.Database;
/** Ordered schema migrations; `PRAGMA user_version` records the last one applied. */
export const MIGRATIONS: ReadonlyArray<{ version: number; file: string }> = [
  { version: 1, file: '001_initial_workspace_schema.sql' },
  { version: 2, file: '002_execution_branches.sql' },
  { version: 3, file: '003_execution_review.sql' },
  { version: 4, file: '004_task_outcomes.sql' },
  { version: 5, file: '005_autonomy.sql' },
  { version: 6, file: '006_decision_policy.sql' },
];
const migrationPath = (file: string) => fileURLToPath(new URL(`./migrations/${file}`, import.meta.url));
export interface OpenDatabaseOptions { filename: string; readonly?: boolean; initialize?: boolean }
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const db = new Database(options.filename, { readonly: options.readonly ?? false });
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!(options.readonly ?? false)) {
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    if (options.filename !== ':memory:') db.pragma('journal_mode = WAL');
    if (options.initialize !== false) migrate(db);
  }
  return db;
}
export function closeDatabase(db: SqliteDatabase): void { db.close(); }

/**
 * Applies pending migrations in order, each exactly once and in its own transaction.
 * `PRAGMA user_version` records the last applied version (0 for a brand-new file).
 */
export function migrate(db: SqliteDatabase): number {
  let current = Number(db.pragma('user_version', { simple: true })) || 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const sql = readFileSync(migrationPath(migration.file), 'utf8');
    if (migration.version === 1) {
      // The initial schema sets journal_mode, which SQLite refuses inside a transaction; it is idempotent (IF NOT EXISTS).
      db.exec(sql);
      db.pragma('user_version = 1');
    } else {
      db.transaction(() => {
        db.exec(sql);
        db.pragma('user_version = ' + migration.version);
      }).immediate();
    }
    current = migration.version;
  }
  return current;
}
