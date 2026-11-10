import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase,closeDatabase,type SqliteDatabase } from '@infrastructure/persistence/sqlite/database.js';
import { SqliteProjectRepository } from '@infrastructure/persistence/repositories/sqlite-project-repository.js';
import { SqliteKnowledgeGraphRepository } from '@infrastructure/persistence/repositories/sqlite-knowledge-graph-repository.js';
import { SqliteUnitOfWork } from '@infrastructure/persistence/sqlite/unit-of-work.js';
import { CreateProjectUseCase } from '@application/projects/create-project.js';
import { GetGraphViewUseCase } from '@application/graph/get-graph-view.js';
import { GetEntityInspectorDetailsUseCase } from '@application/graph/get-entity-inspector-details.js';
import { layoutGraph } from '@desktop/presentation/graph/graph-layout.js';
import type { KnowledgeEntity } from '@domain/graph/knowledge-entity.js';
const handles:SqliteDatabase[]=[];const now='2026-11-10T00:00:00.000Z';
function setup(){const db=openDatabase({filename:':memory:'});handles.push(db);const projects=new SqliteProjectRepository(db),graph=new SqliteKnowledgeGraphRepository(db);new CreateProjectUseCase(new SqliteUnitOfWork(db),projects).execute({project:{id:'p',name:'Workspace Demo',slug:'workspace-demo',createdAt:now,updatedAt:now},rootEntityId:'root'});return {db,projects,graph};}
afterEach(()=>{while(handles.length)closeDatabase(handles.pop()!);});
function entity(id:string,type:KnowledgeEntity['entityType'],parentId:string|null=null,title=id):KnowledgeEntity{return {id,projectId:'p',entityType:type,displayKey:id.toUpperCase(),title,summary:`Summary ${id}`,status:type==='WORK_ITEM'?'READY':'DRAFT',parentId,createdRevision:1,updatedRevision:1,createdAt:now,updatedAt:now};}
describe('graph read projections',()=>{
 it('projects typed graph nodes and cross edges, then applies filters',()=>{
  const {projects,graph}=setup();
  const values=[entity('module','MODULE','root'),entity('feature','FEATURE','module'),entity('task-a','WORK_ITEM','feature','Build UI'),entity('task-b','WORK_ITEM','feature','Write tests'),entity('requirement','REQUIREMENT','root'),entity('adr','DECISION_RECORD')];
  values.forEach(value=>graph.insertEntity(value));
  graph.insertRelationship({id:'dep',projectId:'p',sourceId:'task-a',targetId:'task-b',edgeType:'DEPENDS_ON',provenance:'USER',createdRevision:1,createdAt:now});
  graph.insertRelationship({id:'satisfies',projectId:'p',sourceId:'feature',targetId:'requirement',edgeType:'SATISFIES',provenance:'USER',createdRevision:1,createdAt:now});
  graph.insertRelationship({id:'affects',projectId:'p',sourceId:'adr',targetId:'feature',edgeType:'AFFECTS',provenance:'USER',createdRevision:1,createdAt:now});
  const useCase=new GetGraphViewUseCase(projects,graph);const result=useCase.execute('p');
  expect(result.nodes.map(n=>n.type)).toContain('PROJECT_ROOT');expect(result.edges.map(e=>e.type).sort()).toEqual(['AFFECTS','DEPENDS_ON','SATISFIES']);
  const filtered=useCase.execute('p',{entityTypes:['FEATURE','REQUIREMENT'],edgeTypes:['SATISFIES']});
  expect(filtered.nodes.map(n=>n.type)).toEqual(['FEATURE','REQUIREMENT']);expect(filtered.edges.map(e=>e.type)).toEqual(['SATISFIES']);
 });
 it('returns inspector properties, both relationship directions, and work execution history',()=>{
  const {db,graph}=setup();
  graph.insertEntity(entity('feature','FEATURE','root','Account Security'));graph.insertEntity(entity('task','WORK_ITEM','feature','Add MFA'));graph.insertEntity(entity('adr','DECISION_RECORD',null,'Use WebAuthn'));
  db.prepare("INSERT INTO features(entity_id,scope,priority,business_value,complexity_estimate) VALUES('feature','Passkeys','HIGH','Reduce account takeover',5)").run();
  db.prepare("INSERT INTO work_items(entity_id,work_type,priority,scope_notes,acceptance_criteria_json,recommended_profile_role) VALUES('task','TASK','HIGH','Implement registration','[]','DEVELOPER')").run();
  graph.insertRelationship({id:'decision',projectId:'p',sourceId:'adr',targetId:'feature',edgeType:'AFFECTS',provenance:'USER',createdRevision:1,createdAt:now});
  graph.insertRelationship({id:'task-feature',projectId:'p',sourceId:'task',targetId:'feature',edgeType:'IMPLEMENTS',provenance:'USER',createdRevision:1,createdAt:now});
  db.prepare("INSERT INTO agent_profiles(id,project_id,role_key,name,system_instructions) VALUES('profile','p','DEVELOPER','Developer','')").run();
  db.prepare("INSERT INTO agent_providers(id,provider_key,display_name,adapter_version,capabilities_json) VALUES('provider','codex','Codex','1','{}')").run();
  db.prepare("INSERT INTO agent_executions(id,project_id,work_item_id,profile_id,provider_id,status,initial_commit,started_at,result_summary) VALUES('exec-1','p','task','profile','provider','COMPLETED','abc',?,'Implemented MFA')").run(now);
  const featureDetails=new GetEntityInspectorDetailsUseCase(graph).execute('feature');
  expect(featureDetails.entity.label).toBe('Account Security');expect(featureDetails.attributes.scope).toBe('Passkeys');
  expect(featureDetails.relationships.map(r=>`${r.type}:${r.direction}`)).toEqual(['AFFECTS:INCOMING','IMPLEMENTS:INCOMING']);
  const taskDetails=new GetEntityInspectorDetailsUseCase(graph).execute('task');
  expect(taskDetails.executionHistory).toEqual([{id:'exec-1',status:'COMPLETED',startedAt:now,completedAt:null,resultSummary:'Implemented MFA'}]);
 });
 it('lays out hierarchy with children below parents and independent siblings apart',()=>{
  const view=(id:string,type:import('../../src/shared/contracts/graph-view.js').KnowledgeEntityType,parentId?:string)=>({id,key:id,type,label:id,status:'DRAFT',...(parentId?{parentId}:{})});const root=view('root','PROJECT_ROOT');const module=view('module','MODULE','root');const feature=view('feature','FEATURE','module');const taskA=view('a','WORK_ITEM','feature');const taskB=view('b','WORK_ITEM','feature');
  const result=layoutGraph([root,module,feature,taskA,taskB]);const byId=new Map(result.map(item=>[item.node.id,item]));
  expect(byId.get('root')!.y).toBeLessThan(byId.get('module')!.y);expect(byId.get('module')!.y).toBeLessThan(byId.get('feature')!.y);expect(byId.get('feature')!.y).toBeLessThan(byId.get('a')!.y);expect(byId.get('a')!.x).not.toBe(byId.get('b')!.x);
 });
});
