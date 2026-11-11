import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, closeDatabase, type SqliteDatabase } from '@infrastructure/persistence/sqlite/database.js';
import { SqliteAgentExecutionRepository } from '@infrastructure/persistence/repositories/sqlite-agent-execution-repository.js';
import { coveredWorkItems, type AgentExecution } from '../../src/domain/agents/models.js';

const handles:SqliteDatabase[]=[];
afterEach(()=>{while(handles.length)closeDatabase(handles.pop()!);});

/** A project with three tasks, a provider and a DEVELOPER profile, written straight to the schema (no use cases needed). */
function seeded():{db:SqliteDatabase;repository:SqliteAgentExecutionRepository} {
 const db=openDatabase({filename:':memory:'});handles.push(db);
 db.prepare("INSERT INTO projects(id,name,slug,current_revision,created_at,updated_at) VALUES('p','P','p',1,'now','now')").run();
 const entity=db.prepare("INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES(?,'p','WORK_ITEM',?,?,'Summary','READY',NULL,1,1,'now','now')");
 for(const [id,key] of [['t1','TASK-001'],['t2','TASK-002'],['t3','TASK-003']])entity.run(id,key,`Task ${key}`);
 db.prepare("INSERT INTO agent_providers(id,provider_key,display_name,adapter_version,capabilities_json) VALUES('prov','claude-code','Claude','1','{}')").run();
 db.prepare("INSERT INTO agent_profiles(id,project_id,role_key,name,system_instructions,default_provider_id,default_policy_id) VALUES('dev','p','DEVELOPER','Dev','do it','prov',NULL)").run();
 return {db,repository:new SqliteAgentExecutionRepository(db)};
}
const execution=(id:string,workItemId:string,coveredWorkItemIds?:string[]):AgentExecution=>({id,projectId:'p',workItemId,profileId:'dev',providerId:'prov',sessionId:null,contextSnapshotId:null,status:'QUEUED',modelUsed:null,initialCommit:'abc',finalCommit:null,branchOrWorktree:null,baseBranch:null,testSummary:null,resultSummary:null,startedAt:null,completedAt:null,...(coveredWorkItemIds?{coveredWorkItemIds}:{})});

describe('executions that cover several tasks (Etapa 0, entrega 0.1)',()=>{
 it('persists the covered tasks in order, leader first, and reads them back one by one and in the project list',()=>{
  const {db,repository}=seeded();
  repository.createExecution(execution('g1','t1',['t1','t2','t3']));
  repository.createExecution(execution('s1','t2'));
  expect(repository.findExecution('g1')?.coveredWorkItemIds).toEqual(['t1','t2','t3']);
  expect(repository.findExecution('g1')?.workItemId).toBe('t1');
  expect(repository.findExecution('s1')?.coveredWorkItemIds).toBeUndefined();
  const listed=new Map(repository.listExecutions('p').map(item=>[item.id,item]));
  expect(listed.get('g1')?.coveredWorkItemIds).toEqual(['t1','t2','t3']);
  expect(listed.get('s1')?.coveredWorkItemIds).toBeUndefined();
  expect(db.prepare('SELECT work_item_id,position FROM execution_work_items WHERE execution_id=? ORDER BY position').all('g1')).toEqual([{work_item_id:'t1',position:0},{work_item_id:'t2',position:1},{work_item_id:'t3',position:2}]);
  // A single-task execution writes no rows: the table only describes grouped runs.
  expect(db.prepare('SELECT COUNT(*) AS n FROM execution_work_items WHERE execution_id=?').get('s1')).toEqual({n:0});
 });

 it('always puts the leader first even when the caller listed it elsewhere or left it out',()=>{
  const {repository}=seeded();
  repository.createExecution(execution('g2','t2',['t3','t2']));
  repository.createExecution(execution('g3','t3',['t1']));
  expect(repository.findExecution('g2')?.coveredWorkItemIds).toEqual(['t2','t3']);
  expect(repository.findExecution('g3')?.coveredWorkItemIds).toEqual(['t3','t1']);
 });

 it('coveredWorkItems falls back to the leader for executions created before the grouping option',()=>{
  expect(coveredWorkItems({workItemId:'t1'})).toEqual(['t1']);
  expect(coveredWorkItems({workItemId:'t1',coveredWorkItemIds:[]})).toEqual(['t1']);
  expect(coveredWorkItems({workItemId:'t1',coveredWorkItemIds:['t1','t2']})).toEqual(['t1','t2']);
  expect(coveredWorkItems({workItemId:null,coveredWorkItemIds:['t2']})).toEqual(['t2']);
 });

 it('drops the covered rows with the execution and ignores a task deleted from the graph',()=>{
  const {db,repository}=seeded();
  repository.createExecution(execution('g4','t1',['t1','t2']));
  db.prepare("DELETE FROM knowledge_entities WHERE id='t2'").run();
  expect(repository.findExecution('g4')?.coveredWorkItemIds).toBeUndefined();
  db.prepare("DELETE FROM agent_executions WHERE id='g4'").run();
  expect(db.prepare('SELECT COUNT(*) AS n FROM execution_work_items').get()).toEqual({n:0});
 });
});
