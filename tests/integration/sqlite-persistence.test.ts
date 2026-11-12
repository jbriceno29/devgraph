import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, closeDatabase, type SqliteDatabase } from '../../src/platform/sqlite/database.js';
import { SqliteProjectRepository } from '../../src/modules/projects/infrastructure/sqlite-project-repository.js';
import { SqliteKnowledgeGraphRepository } from '../../src/modules/knowledge/infrastructure/sqlite-knowledge-graph-repository.js';
import { SqliteUnitOfWork } from '../../src/platform/sqlite/unit-of-work.js';
import { CreateProjectUseCase } from '../../src/modules/projects/application/create-project.js';
const handles: SqliteDatabase[] = [];
const migrationPath = fileURLToPath(
  new URL('../../src/platform/sqlite/migrations/001_initial_workspace_schema.sql', import.meta.url),
);
const implementationPlanPath = fileURLToPath(new URL('../../docs/IMPLEMENTATION_PLAN.md', import.meta.url));
function memoryDb(): SqliteDatabase {
  const db = openDatabase({ filename: ':memory:' });
  handles.push(db);
  return db;
}
afterEach(() => {
  while (handles.length) closeDatabase(handles.pop()!);
});
const now = '2026-11-10T00:00:00.000Z';
describe('SQLite Stage 1 foundations', () => {
  it('creates a project and PROJECT_ROOT PROJ-01 at graph revision 1', () => {
    const db = memoryDb();
    const uow = new SqliteUnitOfWork(db);
    const projects = new SqliteProjectRepository(db);
    new CreateProjectUseCase(uow, projects).execute({
      project: { id: 'p1', name: 'Graph Workspace', slug: 'graph-workspace', createdAt: now, updatedAt: now },
      rootEntityId: 'root1',
    });
    expect(projects.findById('p1')?.currentRevision).toBe(1);
    expect(
      db.prepare('SELECT entity_type,display_key,created_revision FROM knowledge_entities WHERE id=?').get('root1'),
    ).toEqual({ entity_type: 'PROJECT_ROOT', display_key: 'PROJ-01', created_revision: 1 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
  it('indexes inserts and updates through FTS5 triggers', () => {
    const db = memoryDb();
    const repo = new SqliteProjectRepository(db);
    const graph = new SqliteKnowledgeGraphRepository(db);
    new SqliteUnitOfWork(db).execute(() =>
      repo.createWithProjectRoot({
        project: { id: 'p1', name: 'Initial Atlas', slug: 'initial-atlas', createdAt: now, updatedAt: now },
        rootEntityId: 'root1',
      }),
    );
    const search = (term: string) =>
      db.prepare('SELECT entity_id FROM fts_knowledge_index WHERE fts_knowledge_index MATCH ?').all(term);
    expect(search('Initial').length).toBe(1);
    const root = graph.findEntityById('root1')!;
    graph.insertEntity({
      ...root,
      id: 'm1',
      entityType: 'MODULE',
      displayKey: 'MOD-01',
      title: 'Payments',
      parentId: 'root1',
    });
    expect(search('Payments')).toHaveLength(1);
    db.prepare("UPDATE knowledge_entities SET title='Billing' WHERE id='m1'").run();
    expect(search('Payments')).toHaveLength(0);
    expect(search('Billing')).toHaveLength(1);
    db.prepare("DELETE FROM knowledge_entities WHERE id='m1'").run();
    expect(search('Billing')).toHaveLength(0);
  });
  it('rolls back all writes when the UnitOfWork callback fails', () => {
    const db = memoryDb();
    const repo = new SqliteProjectRepository(db);
    const uow = new SqliteUnitOfWork(db);
    expect(() =>
      uow.execute(() => {
        repo.createWithProjectRoot({
          project: { id: 'p1', name: 'A', slug: 'a', createdAt: now, updatedAt: now },
          rootEntityId: 'r1',
        });
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(db.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({ n: 0 });
  });

  it('keeps the initial migration byte-for-byte aligned with the specified DDL', () => {
    const plan = readFileSync(implementationPlanPath, 'utf8');
    const start = plan.indexOf('```sql\n') + '```sql\n'.length;
    const end = plan.indexOf('\n```', start);
    expect(readFileSync(migrationPath, 'utf8')).toBe(plan.slice(start, end) + '\n');
  });
  it('enables WAL for file-backed workspaces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graphdev2-sqlite-'));
    const db = openDatabase({ filename: join(dir, 'workspace.sqlite') });
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
