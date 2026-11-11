import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS, closeDatabase, openDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const columns=(db:Database.Database,table:string)=>(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(column=>column.name);
const latest=MIGRATIONS.at(-1)!.version;

describe('versioned schema migrations',()=>{
 it('creates a new workspace at the latest version',()=>{
  const db=openDatabase({filename:':memory:'});
  expect(db.pragma('user_version',{simple:true})).toBe(latest);
  expect(columns(db,'agent_executions')).toContain('base_branch');
  expect(columns(db,'feature_branches')).toEqual(['feature_id','project_id','repository_id','branch_name','source_branch','created_at']);
  closeDatabase(db);
 });

 it('upgrades a version-1 workspace in place, keeps its rows and is idempotent on reopen',()=>{
  const root=mkdtempSync(join(tmpdir(),'graphdev2-migrate-'));roots.push(root);const filename=join(root,'workspace.sqlite');
  const legacy=new Database(filename);
  legacy.exec(readFileSync(fileURLToPath(new URL('../../src/infrastructure/persistence/sqlite/migrations/001_initial_workspace_schema.sql',import.meta.url)),'utf8'));
  legacy.pragma('user_version = 1');
  legacy.prepare("INSERT INTO projects(id,name,slug,current_revision,created_at,updated_at) VALUES('p','P','p',1,'now','now')").run();
  legacy.close();
  for(let open=0;open<2;open+=1){
   const db=openDatabase({filename});
   expect(db.pragma('user_version',{simple:true})).toBe(latest);
   expect(columns(db,'agent_executions')).toContain('base_branch');
   expect(db.prepare('SELECT name FROM projects').all()).toEqual([{name:'P'}]);
   closeDatabase(db);
  }
 });
});

describe('opening an existing project',()=>{
 it('migrates a version-1 project workspace when the app opens it, as the app does (regression)',async()=>{
  const { ProjectWorkspaceStore } = await import('../../src/infrastructure/persistence/sqlite/project-workspace-store.js');
  const root=mkdtempSync(join(tmpdir(),'graphdev2-open-'));roots.push(root);
  const store=new ProjectWorkspaceStore(root);
  const created=store.createProject({name:'Legacy',slug:'legacy'});store.closeAll();
  const filename=join(root,'projects',created.id,'workspace.sqlite');
  // Downgrade to what the previous app version left on disk: schema 001 only, user_version 1.
  const legacy=new Database(filename);for(const table of ['pilot_events','pilot_runs','feature_autonomy','task_outcomes','feature_branches'])legacy.exec(`DROP TABLE ${table}`);legacy.exec('ALTER TABLE autonomy_policies DROP COLUMN max_execution_minutes');for(const column of ['base_branch','execution_branch','revision_of','review_status','review_note','merged_commit','reviewed_at'])legacy.exec(`ALTER TABLE agent_executions DROP COLUMN ${column}`);legacy.pragma('user_version = 1');legacy.close();
  const reopened=new ProjectWorkspaceStore(root);
  expect(reopened.listProjects().map(project=>project.name)).toEqual(['Legacy']);
  const workspace=reopened.openProject(created.id);
  expect(workspace.database.pragma('user_version',{simple:true})).toBe(latest);
  expect(columns(workspace.database,'agent_executions')).toContain('base_branch');
  reopened.closeAll();
 });
});
