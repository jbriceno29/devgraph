import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type SqliteDatabase = Database.Database;
const schemaPath = fileURLToPath(new URL('./migrations/001_initial_workspace_schema.sql', import.meta.url));
export interface OpenDatabaseOptions { filename: string; readonly?: boolean; initialize?: boolean }
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const db = new Database(options.filename, { readonly: options.readonly ?? false });
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!(options.readonly ?? false)) {
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    if (options.filename !== ':memory:') db.pragma('journal_mode = WAL');
    if (options.initialize !== false) {
      const schema = readFileSync(schemaPath, 'utf8');
      db.exec(schema);
      db.pragma('user_version = 1');
    }
  }
  return db;
}
export function closeDatabase(db: SqliteDatabase): void { db.close(); }
