import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { InceptionEnginePort } from '../../src/application/ports/inception-port.js';
import type { ChangeOperation } from '../../src/domain/knowledge/change-set.js';
import type { ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';
import type { InceptionViewDto } from '../../src/shared/contracts/inception-view.js';
import { DEFAULT_DECISION_POLICY, decide, normalizeDecisionPolicy } from '../../src/domain/autonomy/decision-policy.js';
import { ChangeSetValidator } from '../../src/application/planning/changeset-validator.js';
import { NO_INSTALL_RULE } from '../../src/application/inception/foundation-plan.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

const usage={inputTokens:100,outputTokens:50,cacheReadTokens:0,cacheCreationTokens:0,costUsd:0.001,model:'fake'};
const proposal=():ChangeOperation[]=>[
 {type:'SET_PROJECT_PROFILE',description:'Lista de tareas en la terminal.',objectives:['Gestionar tareas personales desde la terminal'],outOfScope:['Sincronización en la nube'],techStack:{lenguaje:'JavaScript (ESM)',runtime:'Node.js 22',pruebas:'node --test'},rules:['Identificadores en inglés; textos de usuario en español.','Pruebas en tests/ con node:test.'],verificationCommands:['node --test']},
 {type:'CREATE_DECISION_RECORD',tempId:'$adr',title:'ADR-001: Stack',contextMd:'Proyecto pequeño.',alternativesMd:'- Node.js sin dependencias: simple.\n- Python: otro runtime.',decisionMd:'Node.js 22 sin dependencias.',consequencesMd:'Sin instalar nada.',relativePath:'docs/architecture/ADR/ADR-001-stack.md'},
 {type:'UPSERT_ARTIFACT',tempId:'$vision',parentId:null,artifactType:'PRD',title:'Visión',relativePath:'docs/VISION.md',markdownContent:'# Visión\n\nTareas en la terminal.\n'},
 {type:'CREATE_REQUIREMENT',tempId:'$req',title:'Crear tareas',summary:'El usuario crea tareas.',reqType:'FUNCTIONAL',priority:'HIGH',acceptanceCriteria:['Se crea una tarea con título']},
 {type:'CREATE_MODULE',tempId:'$mod',title:'Núcleo',summary:'Todo el código.',purpose:'Núcleo de la app'},
 {type:'CREATE_FEATURE',tempId:'$f0',moduleId:'$mod',title:'Fundación',summary:'Scaffold y convenciones.',scope:'Estructura',priority:'CRITICAL'},
 {type:'CREATE_WORK_ITEM',tempId:'$t1',parentId:'$f0',workType:'TASK',title:'Crear el scaffold',summary:'Estructura mínima y prueba de humo.',acceptanceCriteria:['node --test pasa']},
 {type:'CREATE_WORK_ITEM',tempId:'$t2',parentId:'$f0',workType:'TASK',title:'Módulo de errores',summary:'Errores comunes.',acceptanceCriteria:['Hay pruebas']},
 {type:'CREATE_FEATURE',tempId:'$f1',moduleId:'$mod',title:'Gestión de tareas',summary:'Crear y listar.',scope:'CLI',priority:'HIGH'},
 {type:'CREATE_WORK_ITEM',tempId:'$t3',parentId:'$f1',workType:'TASK',title:'Crear tareas',summary:'add',acceptanceCriteria:['ok']},
 {type:'CREATE_WORK_ITEM',tempId:'$t4',parentId:'$f1',workType:'TASK',title:'Listar tareas',summary:'list',acceptanceCriteria:['ok']},
 {type:'CREATE_RELATIONSHIP',sourceId:'$t4',targetId:'$t3',edgeType:'DEPENDS_ON'},
 {type:'CREATE_RELATIONSHIP',sourceId:'$adr',targetId:'ROOT',edgeType:'AFFECTS'},
];

class FakeEngine implements InceptionEnginePort {
 calls:Array<{kind:string;model?:string;answers?:unknown;notes?:string[]}>=[];fail=false;hang=false;signals:AbortSignal[]=[];
 async askGoals(input:Parameters<InceptionEnginePort['askGoals']>[0]){
  this.calls.push({kind:'ask',...(input.model?{model:input.model}:{})});if(this.fail)throw new Error('motor caído');
  if(this.hang)await this.wait(input.signal);
  return {questions:[{id:'q1',text:'¿Quién la usa?',options:['Solo yo','Un equipo'],default:'Solo yo',why:'Define el alcance.'},{id:'q2',text:'¿Interfaz?',options:['Terminal','Web'],default:'Terminal',why:'Define la plataforma.'},{id:'q3',text:'¿Qué queda fuera?',options:[],default:null,why:'Evita sobrediseñar.'}],assumptions:['Uso personal'],usage};
 }
 /** Like the real engine: never answers until aborted, then rejects as cancelled. */
 wait(signal?:AbortSignal):Promise<never>{if(signal)this.signals.push(signal);return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(Object.assign(new Error('cancelada'),{name:'AbortError'})),{once:true}));}
 async propose(input:Parameters<InceptionEnginePort['propose']>[0]){
  this.calls.push({kind:'propose',...(input.model?{model:input.model}:{}),answers:input.answers,...(input.notes?{notes:input.notes}:{})});
  if(this.hang)await this.wait(input.signal);
  const operations=proposal().map(op=>op.type==='CREATE_RELATIONSHIP'&&op.targetId==='ROOT'?{...op,targetId:input.project.rootId}:op);
  return {draft:{title:'Inicio: tareas en terminal',rationale:'Lo más simple.',operations},assumptions:['Sin nube'],usage};
 }
}

async function setup(){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-inception-'));roots.push(root);
 const events:Array<{channel:string;payload:unknown}>=[];const engine=new FakeEngine();
 const core=createWorkspaceCore(join(root,'workspace'),(channel,payload)=>events.push({channel,payload}),{inceptionEngine:engine});cores.push(core);
 const project=await core.handle({channel:'project:create',args:[{name:'Tareas',slug:'tareas'}]}) as {id:string};
 await core.handle({channel:'project:open',args:[project.id]});
 const call=async<T,>(channel:string,...args:unknown[])=>await core.handle({channel:channel as never,args}) as T;
 const settled=async()=>{await core.inceptionSettled(project.id);return call<InceptionViewDto>('inception:get',project.id);};
 return {root,core,engine,events,projectId:project.id,call,settled,dbPath:join(root,'workspace','projects',project.id,'workspace.sqlite')};
}
const query=<T,>(dbPath:string,sql:string,...params:unknown[])=>{const db=openDatabase({filename:dbPath,initialize:false});try{return db.prepare(sql).all(...params) as T[];}finally{closeDatabase(db);}};

describe('project inception (core)',()=>{
 it('runs the two gates: questions, one proposal, approval with profile, ADR, vision and plan',async()=>{
  const {root,engine,events,projectId,call,settled,dbPath}=await setup();
  expect((await call<InceptionViewDto>('inception:get',projectId))).toMatchObject({stage:'NOT_STARTED',status:'IDLE',nextAction:'START'});
  const started=await call<InceptionViewDto>('inception:start',projectId,{brief:'Una lista de tareas para la terminal.'});
  expect(started).toMatchObject({stage:'ASK_GOALS',status:'WORKING',nextAction:'WAIT',model:'opus'});
  const asked=await settled();
  expect(asked).toMatchObject({stage:'ASK_GOALS',status:'WAITING_USER',nextAction:'ANSWER',assumptions:['Uso personal']});
  expect(asked.questions.map(question=>question.id)).toEqual(['q1','q2','q3']);
  expect(engine.calls[0]).toEqual({kind:'ask',model:'opus'});
  expect(events.some(event=>event.channel==='inception:updated'&&(event.payload as {status:string}).status==='WAITING_USER')).toBe(true);
  let activity=await call<ActivitySummaryDto>('activity:list',projectId);
  expect(activity.inception).toMatchObject({title:'Inicio del proyecto: te falta responder',needsAttention:true});expect(activity.attentionCount).toBe(1);

  await call('inception:answer',projectId,[{questionId:'q1',answer:'Solo yo'},{questionId:'q2',answer:'Terminal'}]);
  const proposed=await settled();
  expect(engine.calls[1]).toMatchObject({kind:'propose',model:'opus',answers:[{questionId:'q1',answer:'Solo yo'},{questionId:'q2',answer:'Terminal'},{questionId:'q3',answer:''}]});
  expect(proposed).toMatchObject({stage:'PROPOSAL',status:'WAITING_USER',nextAction:'SET_UP_REPOSITORY',error:null});
  expect(proposed.proposal).toMatchObject({status:'VALIDATED',scaffoldTaskTitle:'Crear el scaffold',profile:{verificationCommands:['node --test']},decision:{title:'ADR-001: Stack'}});
  expect(proposed.proposal!.decisionReasons.join(' ')).toContain('siempre pide tu aprobación');
  expect(proposed.proposal!.features).toEqual([
   {tempId:'$f0',title:'Fundación',isFoundation:true,dependsOn:[],tasks:[{tempId:'$t1',title:'Crear el scaffold',initialStatus:'READY'},{tempId:'$t2',title:'Módulo de errores',initialStatus:'BLOCKED'}]},
   {tempId:'$f1',title:'Gestión de tareas',isFoundation:false,dependsOn:['Fundación'],tasks:[{tempId:'$t3',title:'Crear tareas',initialStatus:'BLOCKED'},{tempId:'$t4',title:'Listar tareas',initialStatus:'BLOCKED'}]},
  ]);
  expect(proposed.usage).toMatchObject({calls:2,inputTokens:200,outputTokens:100});
  // Nothing is applied before the approval: PROJECT_FOUNDATION never applies on its own.
  expect(query<{objectives_json:string}>(dbPath,'SELECT objectives_json FROM projects')[0]!.objectives_json).toBe('[]');
  await expect(call('inception:approve',projectId)).rejects.toThrow(/repositorio Git/);
  activity=await call<ActivitySummaryDto>('activity:list',projectId);
  expect(activity.items.find(item=>item.kind==='PLAN_PROPOSAL')).toMatchObject({title:'Inicio del proyecto: te falta aprobar',changeSetId:proposed.proposal!.changeSetId,needsAttention:true});

  const repo=join(root,'nuevo-repo');
  const created=await call<{localPath:string;initialCommit:string;files:string[]}>('repository:initialize',projectId,repo);
  expect(created).toMatchObject({localPath:repo,files:['README.md','.gitignore']});
  expect((await call<InceptionViewDto>('inception:get',projectId)).nextAction).toBe('APPROVE');
  const applied=await call<InceptionViewDto>('inception:approve',projectId);
  expect(applied).toMatchObject({stage:'APPLIED',status:'DONE',nextAction:'DONE'});
  expect((await call<ActivitySummaryDto>('activity:list',projectId)).inception).toBeUndefined();

  const project=query<{objectives_json:string;out_of_scope_json:string;tech_stack_json:string;rules_json:string;description:string}>(dbPath,'SELECT * FROM projects')[0]!;
  expect(JSON.parse(project.objectives_json)).toEqual(['Gestionar tareas personales desde la terminal']);
  expect(JSON.parse(project.out_of_scope_json)).toEqual(['Sincronización en la nube']);
  expect(JSON.parse(project.tech_stack_json)).toMatchObject({runtime:'Node.js 22'});
  expect(JSON.parse(project.rules_json)).toHaveLength(2);
  expect((await call<{allowedCommands:string[]}>('policy:get',projectId)).allowedCommands).toEqual(['node --test']);
  const tasks=query<{id:string;title:string;status:string;summary:string}>(dbPath,`SELECT id,title,status,summary FROM knowledge_entities WHERE entity_type='WORK_ITEM' ORDER BY display_key`);
  expect(tasks.map(task=>[task.title,task.status])).toEqual([['Crear el scaffold','READY'],['Módulo de errores','BLOCKED'],['Crear tareas','BLOCKED'],['Listar tareas','BLOCKED']]);
  expect(tasks[0]!.summary).toContain(NO_INSTALL_RULE);
  const featureEdges=query<{source:string;target:string}>(dbPath,`SELECT s.title AS source,t.title AS target FROM graph_edges e JOIN knowledge_entities s ON s.id=e.source_id JOIN knowledge_entities t ON t.id=e.target_id WHERE e.edge_type='DEPENDS_ON' AND s.entity_type='FEATURE'`);
  expect(featureEdges).toEqual([{source:'Gestión de tareas',target:'Fundación'}]);
  expect(readFileSync(join(repo,'docs','architecture','ADR','ADR-001-stack.md'),'utf8')).toContain('Python: otro runtime');
  expect(existsSync(join(repo,'docs','VISION.md'))).toBe(true);
  expect(execFileSync('git',['log','--format=%s'],{cwd:repo,encoding:'utf8'}).trim().split('\n')).toHaveLength(2);

  // Every run's level-1 context carries the goal and the stack, compactly.
  const context=await call<{packageText:string;snapshot:{includedSources:Array<{sourceId:string;authorityTier:number;extractedContent:string}>}}>('context:preview_package',{projectId,focusEntityId:tasks[0]!.id});
  const profile=context.snapshot.includedSources.find(source=>source.sourceId===`profile:${projectId}`)!;
  expect(profile.authorityTier).toBe(1);
  expect(profile.extractedContent).toBe('Objetivo: Gestionar tareas personales desde la terminal\nFuera de alcance: Sincronización en la nube\nStack: lenguaje: JavaScript (ESM); runtime: Node.js 22; pruebas: node --test');
  expect(context.packageText).toContain('Stack: lenguaje: JavaScript (ESM)');
  await expect(call('inception:restart',projectId)).rejects.toThrow(/ya se aplicó/);
 });

 it('restarts from scratch, rejecting the pending proposal; a failed call can be retried',async()=>{
  const {engine,projectId,call,settled}=await setup();
  engine.fail=true;
  await call('inception:start',projectId,{brief:'Algo'});
  expect(await settled()).toMatchObject({stage:'ASK_GOALS',status:'FAILED',nextAction:'RETRY_QUESTIONS',error:'motor caído'});
  expect((await call<ActivitySummaryDto>('activity:list',projectId)).inception).toMatchObject({needsAttention:true,title:'Inicio del proyecto: falló la última llamada'});
  engine.fail=false;
  await call('inception:start',projectId,{brief:'Algo',model:'haiku'});
  expect(await settled()).toMatchObject({status:'WAITING_USER',model:'haiku'});
  await expect(call('inception:start',projectId,{brief:'Otra vez'})).rejects.toThrow(/ya empezó/);
  await expect(call('inception:answer',projectId,[{questionId:'nope',answer:'x'}])).rejects.toThrow(/ninguna pregunta/);
  await call('inception:answer',projectId,[]);
  const proposed=await settled();const changeSetId=proposed.proposal!.changeSetId;
  const restarted=await call<InceptionViewDto>('inception:restart',projectId);
  expect(restarted).toMatchObject({stage:'NOT_STARTED',nextAction:'START',questions:[],proposal:null});
  expect((await call<Array<{id:string;status:string}>>('changeset:list',projectId)).find(item=>item.id===changeSetId)!.status).toBe('REJECTED');
  await expect(call('inception:start',projectId,{brief:'  '})).rejects.toThrow(/Describe/);
  await expect(call('inception:start',projectId,{brief:'Nuevo',model:'gpt-x'})).rejects.toThrow(/no está disponible/);
  await call('inception:start',projectId,{brief:'De nuevo'});
  expect(await settled()).toMatchObject({stage:'ASK_GOALS',status:'WAITING_USER',brief:'De nuevo'});
 });

 it('«pedir otra» with notes: they reach the engine, are validated, kept for later regenerations, and the scaffold task id is resolved on approval',async()=>{
  const {root,engine,projectId,call,settled,dbPath}=await setup();
  await call('inception:start',projectId,{brief:'Tareas en la terminal'});await settled();
  await expect(call('inception:answer',projectId,[],'Usa Python')).rejects.toThrow(/propuesta ya preparada/);
  await call('inception:answer',projectId,[{questionId:'q1',answer:'Solo yo'}]);
  const first=await settled();expect(first.notes).toEqual([]);expect(engine.calls.at(-1)).not.toHaveProperty('notes');
  await expect(call('inception:answer',projectId,[],'x'.repeat(2001))).rejects.toThrow(/como mucho 2000 caracteres/);
  expect((await call<InceptionViewDto>('inception:get',projectId)).proposal!.changeSetId).toBe(first.proposal!.changeSetId);
  expect(await call<InceptionViewDto>('inception:answer',projectId,[],'  Usa Python en lugar de Node  ')).toMatchObject({status:'WORKING',notes:['Usa Python en lugar de Node']});
  const second=await settled();
  expect(engine.calls.at(-1)).toMatchObject({kind:'propose',notes:['Usa Python en lugar de Node'],answers:[{questionId:'q1',answer:'Solo yo'},{questionId:'q2',answer:''},{questionId:'q3',answer:''}]});
  expect(second).toMatchObject({stage:'PROPOSAL',status:'WAITING_USER',notes:['Usa Python en lugar de Node']});
  expect(second.proposal!.changeSetId).not.toBe(first.proposal!.changeSetId);
  expect((await call<Array<{id:string;status:string}>>('changeset:list',projectId)).find(item=>item.id===first.proposal!.changeSetId)!.status).toBe('REJECTED');
  // Changing the answers (or retrying) keeps the notes; a new note is added after the earlier ones.
  await call('inception:answer',projectId,[{questionId:'q2',answer:'Web'}]);await settled();
  expect(engine.calls.at(-1)!.notes).toEqual(['Usa Python en lugar de Node']);
  await call('inception:answer',projectId,[],'Sin base de datos');
  expect((await settled()).notes).toEqual(['Usa Python en lugar de Node','Sin base de datos']);
  expect(engine.calls.at(-1)!.notes).toEqual(['Usa Python en lugar de Node','Sin base de datos']);
  expect(second.scaffoldTaskId).toBeNull();
  await call('repository:initialize',projectId,join(root,'repo'));
  const applied=await call<InceptionViewDto>('inception:approve',projectId);
  const scaffold=query<{id:string}>(dbPath,`SELECT id FROM knowledge_entities WHERE entity_type='WORK_ITEM' AND title='Crear el scaffold'`)[0]!;
  expect(applied).toMatchObject({stage:'APPLIED',scaffoldTaskId:scaffold.id});
  expect((await call<InceptionViewDto>('inception:get',projectId)).scaffoldTaskId).toBe(scaffold.id);
  expect(query<{scaffold_task_id:string}>(dbPath,'SELECT scaffold_task_id FROM project_inception')[0]!.scaffold_task_id).toBe(scaffold.id);
 });

 it('restart and close abort the running engine call; a voluntary cancellation is never saved as FAILED',async()=>{
  const {core,engine,projectId,call,dbPath}=await setup();
  await call('inception:start',projectId,{brief:'Algo'});await core.inceptionSettled(projectId);
  engine.hang=true;
  await call('inception:answer',projectId,[]);
  expect(engine.signals).toHaveLength(1);expect(engine.signals[0]!.aborted).toBe(false);
  expect(await call<InceptionViewDto>('inception:restart',projectId)).toMatchObject({stage:'NOT_STARTED',status:'IDLE'});
  expect(engine.signals[0]!.aborted).toBe(true);
  await core.inceptionSettled(projectId);
  expect(await call<InceptionViewDto>('inception:get',projectId)).toMatchObject({stage:'NOT_STARTED',status:'IDLE',error:null});
  await call('inception:start',projectId,{brief:'Otra vez'});
  expect(engine.signals[1]!.aborted).toBe(false);
  core.close();
  expect(engine.signals[1]!.aborted).toBe(true);
  expect(query<{status:string;error:string|null}>(dbPath,'SELECT status,error FROM project_inception')[0]).toEqual({status:'WORKING',error:null});
 });

 it('initializes a new repository only in a missing or empty folder, without hooks or remotes, and never deletes anything',async()=>{
  const {root,projectId,call}=await setup();
  await expect(call('repository:initialize',projectId,'relativa/repo')).rejects.toThrow(/absoluta/);
  await expect(call('repository:initialize',projectId,`${root}/a/../b`)).rejects.toThrow(/«\.\.»/);
  await expect(call('repository:initialize',projectId,join(root,'falta','repo'))).rejects.toThrow(/carpeta padre no existe/);
  const full=join(root,'lleno');mkdirSync(full);writeFileSync(join(full,'mio.txt'),'no tocar');
  await expect(call('repository:initialize',projectId,full)).rejects.toThrow(/no está vacía/);
  expect(readFileSync(join(full,'mio.txt'),'utf8')).toBe('no tocar');expect(existsSync(join(full,'.git'))).toBe(false);
  writeFileSync(join(root,'archivo'),'x');
  await expect(call('repository:initialize',projectId,join(root,'archivo'))).rejects.toThrow(/no es una carpeta/);
  expect(await call('repository:get_path',projectId)).toBeNull();
  const empty=join(root,'vacio');mkdirSync(empty);
  const created=await call<{localPath:string}>('repository:initialize',projectId,empty);
  expect(created.localPath).toBe(empty);expect(await call('repository:get_path',projectId)).toBe(empty);
  expect(execFileSync('git',['symbolic-ref','--short','HEAD'],{cwd:empty,encoding:'utf8'}).trim()).toBe('main');
  expect(execFileSync('git',['remote'],{cwd:empty,encoding:'utf8'}).trim()).toBe('');
  expect(execFileSync('git',['log','--format=%an <%ae>'],{cwd:empty,encoding:'utf8'}).trim()).toBe('Graph Workspace <graph-workspace@localhost>');
  expect(existsSync(join(empty,'.git','hooks'))).toBe(false);
  expect(execFileSync('git',['status','--porcelain'],{cwd:empty,encoding:'utf8'}).trim()).toBe('');
 });

 it('PROJECT_FOUNDATION always asks and is not configurable; the validator refuses install commands',async()=>{
  const allAuto=normalizeDecisionPolicy({rules:{NEW_TASK:'AUTO',TASK_DEPENDENCY:'AUTO',TASK_STATUS:'AUTO',DECISION_RECORD:'AUTO',SCOPE_CHANGE:'AUTO'},maxAutoTasksPerFeature:50});
  const verdict=decide([{type:'SET_PROJECT_PROFILE',objectives:['x'],outOfScope:[],techStack:{a:'b'},rules:[],verificationCommands:[]}],allAuto,{featureTasks:new Set(),featureId:'',autoTasksSoFar:0});
  expect(verdict).toMatchObject({mode:'ASK',categories:['PROJECT_FOUNDATION']});
  expect(()=>normalizeDecisionPolicy({rules:{PROJECT_FOUNDATION:'AUTO'}})).toThrow(/no es configurable/);
  expect(DEFAULT_DECISION_POLICY.rules).not.toHaveProperty('PROJECT_FOUNDATION');
  const {projectId,call}=await setup();
  await expect(call('policy:update',projectId,{writablePaths:['src/**'],readonlyPaths:[],deniedPaths:[],allowedCommands:[],decisionPolicy:{rules:{PROJECT_FOUNDATION:'AUTO'}}})).rejects.toThrow(/no es configurable/);
  const issues=new ChangeSetValidator().validate({id:'c',projectId:'p',baseGraphRevision:1,originType:'AI_CHAT',title:'t',rationale:'',status:'PENDING_APPROVAL',validationIssues:[],createdAt:'now',operations:[{type:'SET_PROJECT_PROFILE',objectives:['x'],outOfScope:[],techStack:{lenguaje:'JS'},rules:[],verificationCommands:['npm install','node --test | tee x','npx vitest','node --test']}]},1,[],[]).issues.map(issue=>issue.message);
  expect(issues).toHaveLength(3);expect(issues.join(' ')).toMatch(/instalar dependencias/);
 });

 it('refuses to start on a project that already has a plan',async()=>{
  const {projectId,call,dbPath}=await setup();
  const db=openDatabase({filename:dbPath,initialize:false});
  try{const root=(db.prepare(`SELECT id FROM knowledge_entities WHERE entity_type='PROJECT_ROOT'`).get() as {id:string}).id;
   db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES('m',?,'MODULE','MOD-001','M','','DRAFT',?,1,1,'now','now')`).run(projectId,root);
   db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES('f',?,'FEATURE','FEAT-001','F','','DRAFT','m',1,1,'now','now')`).run(projectId);
  }finally{closeDatabase(db);}
  await expect(call('inception:start',projectId,{brief:'x'})).rejects.toThrow(/ya tiene un plan/);
 });
});
