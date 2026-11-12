import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS, closeDatabase, openDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name);
const latest = MIGRATIONS.at(-1)!.version;

describe('versioned schema migrations', () => {
  it('creates a new workspace at the latest version', () => {
    const db = openDatabase({ filename: ':memory:' });
    expect(db.pragma('user_version', { simple: true })).toBe(latest);
    expect(columns(db, 'agent_executions')).toContain('base_branch');
    expect(columns(db, 'feature_branches')).toEqual([
      'feature_id',
      'project_id',
      'repository_id',
      'branch_name',
      'source_branch',
      'created_at',
      'integrated_at',
    ]);
    expect(columns(db, 'project_inception')).toEqual(
      expect.arrayContaining(['notes_json', 'scaffold_task_id', 'references_json', 'ui_json']),
    );
    expect(columns(db, 'execution_work_items')).toEqual(['execution_id', 'work_item_id', 'position']);
    expect(columns(db, 'feature_autonomy')).toEqual(expect.arrayContaining(['group_tasks', 'max_group_size']));
    closeDatabase(db);
  });

  it('upgrades a version-1 workspace in place, keeps its rows and is idempotent on reopen', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-migrate-'));
    roots.push(root);
    const filename = join(root, 'workspace.sqlite');
    const legacy = new Database(filename);
    legacy.exec(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../src/infrastructure/persistence/sqlite/migrations/001_initial_workspace_schema.sql',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    );
    legacy.pragma('user_version = 1');
    legacy
      .prepare(
        "INSERT INTO projects(id,name,slug,current_revision,created_at,updated_at) VALUES('p','P','p',1,'now','now')",
      )
      .run();
    legacy.close();
    for (let open = 0; open < 2; open += 1) {
      const db = openDatabase({ filename });
      expect(db.pragma('user_version', { simple: true })).toBe(latest);
      expect(columns(db, 'agent_executions')).toContain('base_branch');
      expect(columns(db, 'execution_work_items')).toEqual(['execution_id', 'work_item_id', 'position']);
      expect(db.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'P' }]);
      closeDatabase(db);
    }
  });
});

describe('migration 012: the inception table is rebuilt for the new stage (and 013 adds the brownfield scan, null for existing rows)', () => {
  it('keeps the rows of an existing workspace and then accepts EXPLORE_UI, which the old CHECK refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-migrate-012-'));
    roots.push(root);
    const filename = join(root, 'workspace.sqlite');
    const previous = new Database(filename);
    for (const file of MIGRATIONS.filter(item => item.version <= 11).map(item => item.file))
      previous.exec(
        readFileSync(
          fileURLToPath(new URL(`../../src/infrastructure/persistence/sqlite/migrations/${file}`, import.meta.url)),
          'utf8',
        ),
      );
    previous.pragma('user_version = 11');
    previous
      .prepare(
        "INSERT INTO projects(id,name,slug,current_revision,created_at,updated_at) VALUES('p','P','p',1,'now','now')",
      )
      .run();
    previous
      .prepare(
        "INSERT INTO project_inception(project_id,stage,status,brief,questions_json,answers_json,assumptions_json,model,usage_json,notes_json,scaffold_task_id,references_json,created_at,updated_at) VALUES('p','PROPOSAL','WAITING_USER','Mi idea','[{\"id\":\"q1\"}]','[{\"questionId\":\"q1\",\"answer\":\"a\"}]','[\"supuesto\"]','opus','[]','[\"nota\"]','t1','[{\"id\":\"ref-1\"}]','antes','ahora')",
      )
      .run();
    expect(() => previous.prepare("UPDATE project_inception SET stage='EXPLORE_UI'").run()).toThrow(/CHECK/);
    previous.close();
    const db = openDatabase({ filename });
    expect(db.pragma('user_version', { simple: true })).toBe(latest);
    expect(db.prepare('SELECT * FROM project_inception').all()).toEqual([
      {
        project_id: 'p',
        stage: 'PROPOSAL',
        status: 'WAITING_USER',
        brief: 'Mi idea',
        questions_json: '[{"id":"q1"}]',
        answers_json: '[{"questionId":"q1","answer":"a"}]',
        assumptions_json: '["supuesto"]',
        change_set_id: null,
        model: 'opus',
        usage_json: '[]',
        error: null,
        notes_json: '["nota"]',
        scaffold_task_id: 't1',
        references_json: '[{"id":"ref-1"}]',
        ui_json: '{}',
        repository_json: 'null',
        created_at: 'antes',
        updated_at: 'ahora',
      },
    ]);
    db.prepare("UPDATE project_inception SET stage='EXPLORE_UI'").run();
    expect(() => db.prepare("UPDATE project_inception SET stage='OTRA'").run()).toThrow(/CHECK/);
    closeDatabase(db);
  });
});

describe('opening an existing project', () => {
  it('migrates a version-1 project workspace when the app opens it, as the app does (regression)', async () => {
    const { ProjectWorkspaceStore } = await import(
      '../../src/infrastructure/persistence/sqlite/project-workspace-store.js'
    );
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-open-'));
    roots.push(root);
    const store = new ProjectWorkspaceStore(root);
    const created = store.createProject({ name: 'Legacy', slug: 'legacy' });
    store.closeAll();
    const filename = join(root, 'projects', created.id, 'workspace.sqlite');
    // Downgrade to what the previous app version left on disk: schema 001 only, user_version 1.
    const legacy = new Database(filename);
    for (const table of [
      'execution_work_items',
      'project_inception',
      'pilot_events',
      'pilot_runs',
      'feature_autonomy',
      'task_outcomes',
      'feature_branches',
    ])
      legacy.exec(`DROP TABLE ${table}`);
    legacy.exec('ALTER TABLE projects DROP COLUMN out_of_scope_json');
    legacy.exec('ALTER TABLE projects DROP COLUMN stack_profile_id');
    legacy.exec('ALTER TABLE projects DROP COLUMN approved_dependencies_json');
    legacy.exec('ALTER TABLE projects DROP COLUMN skills_enabled');
    legacy.exec('ALTER TABLE autonomy_policies DROP COLUMN max_execution_minutes');
    legacy.exec('ALTER TABLE autonomy_policies DROP COLUMN decision_policy_json');
    legacy.exec('ALTER TABLE autonomy_policies DROP COLUMN max_turns');
    for (const column of [
      'base_branch',
      'execution_branch',
      'revision_of',
      'review_status',
      'review_note',
      'merged_commit',
      'reviewed_at',
    ])
      legacy.exec(`ALTER TABLE agent_executions DROP COLUMN ${column}`);
    legacy.pragma('user_version = 1');
    legacy.close();
    const reopened = new ProjectWorkspaceStore(root);
    expect(reopened.listProjects().map(project => project.name)).toEqual(['Legacy']);
    const workspace = reopened.openProject(created.id);
    expect(workspace.database.pragma('user_version', { simple: true })).toBe(latest);
    expect(columns(workspace.database, 'agent_executions')).toContain('base_branch');
    reopened.closeAll();
  });
});
