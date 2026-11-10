import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../../src/infrastructure/ai/claude-code-adapter.js';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type { AgentEvent } from '../../src/domain/agents/models.js';

const fixture=join(__dirname,'..','fixtures','claude','edit-file.stream.jsonl');
const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

/**
 * A stand-in for the `claude` binary. The adapter scrubs the environment, so behaviour is
 * selected by a `mode` file next to the script, and every call is logged with its argv and env.
 */
const FAKE_CLAUDE=`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const dir=__dirname,mode=fs.readFileSync(path.join(dir,'mode'),'utf8').trim(),args=process.argv.slice(2);
fs.appendFileSync(path.join(dir,'invocations.jsonl'),JSON.stringify({args,env:Object.keys(process.env),cwd:process.cwd()})+'\\n');
const out=value=>process.stdout.write(JSON.stringify(value)+'\\n');
// Exit only once stdout is flushed: process.exit() right after a write to a pipe can drop it.
const finish=(text)=>process.stdout.write(text,()=>process.exit(0));
if(args[0]==='auth'){finish(JSON.stringify({loggedIn:mode!=='logged-out',authMethod:'claude.ai'})+'\\n');return;}
let stdin='';process.stdin.on('data',chunk=>stdin+=chunk);
process.stdin.on('end',()=>{
 fs.writeFileSync(path.join(dir,'prompt.txt'),stdin);
 const init={type:'system',subtype:'init',session_id:'fake-session',model:'claude-haiku-5-5',tools:[]};
 if(mode==='replay'){
  fs.mkdirSync(path.join(process.cwd(),'src'),{recursive:true});fs.writeFileSync(path.join(process.cwd(),'src','hello.ts'),"export const hello = 'world';");
  finish(fs.readFileSync(fs.readFileSync(path.join(dir,'fixture'),'utf8').trim(),'utf8').split('/workspace/repo').join(process.cwd()));
  return;
 }
 // Install signal handlers before announcing the session: writes to a pipe are synchronous, so the
 // parent can react to init (and send SIGINT) before the next statement runs.
 if(mode==='wait-sigint')process.on('SIGINT',()=>finish(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,terminal_reason:'aborted_streaming',result:''})+'\\n'));
 if(mode==='ignore-sigint')process.on('SIGINT',()=>{});
 out(init);
 setInterval(()=>{},1000);
});
`;

function fakeClaude(mode:'replay'|'logged-out'|'wait-sigint'|'ignore-sigint'){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-claude-'));roots.push(root);
 const bin=join(root,'bin');mkdirSync(bin);const executable=join(bin,'claude');
 writeFileSync(executable,FAKE_CLAUDE);chmodSync(executable,0o755);writeFileSync(join(bin,'mode'),mode);writeFileSync(join(bin,'fixture'),fixture);
 const work=join(root,'work');mkdirSync(work);
 const invocations=()=>existsSync(join(bin,'invocations.jsonl'))?readFileSync(join(bin,'invocations.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as {args:string[];env:string[];cwd:string}):[];
 return {root,executable,work,invocations,prompt:()=>readFileSync(join(bin,'prompt.txt'),'utf8')};
}

async function collect(stream:AsyncIterable<AgentEvent>,onEvent?:(event:AgentEvent)=>void):Promise<AgentEvent[]>{const events:AgentEvent[]=[];for await(const event of stream){events.push(event);onEvent?.(event);}return events;}

describe('ClaudeCodeAdapter with a simulated CLI',()=>{
 it('checks the login, runs with a scrubbed environment and streams normalized events',async()=>{
  const fake=fakeClaude('replay');
  const saved={CLAUDECODE:process.env.CLAUDECODE,ANTHROPIC_BASE_URL:process.env.ANTHROPIC_BASE_URL,ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY};
  Object.assign(process.env,{CLAUDECODE:'1',ANTHROPIC_BASE_URL:'http://intercept',ANTHROPIC_API_KEY:'sk-should-not-leak'});
  try{
   const adapter=new ClaudeCodeAdapter({executable:fake.executable});
   const events=await collect(adapter.run({executionId:'e1',workingDirectory:fake.work,prompt:'do it',model:'haiku',policy:{writablePaths:['src/**'],readonlyPaths:[],deniedPaths:['.env*'],allowedCommands:[]}}));
   expect(events[0]).toMatchObject({type:'SESSION_INITIALIZED',model:'claude-haiku-5-5'});
   expect(events).toContainEqual(expect.objectContaining({type:'FILE_TOUCHED',relativePath:'src/hello.ts',operation:'CREATE'}));
   expect(events.at(-1)!.type).toBe('EXECUTION_FINISHED');
   const [auth,run]=fake.invocations();
   expect(auth!.args).toEqual(['auth','status','--json']);
   expect(run!.args).toEqual(expect.arrayContaining(['-p','--permission-mode','dontAsk','--model','haiku','--allowedTools','Write(src/**),Edit(src/**)']));
   expect(run!.cwd).toBe(fake.work);expect(fake.prompt()).toBe('do it');
   for(const name of ['CLAUDECODE','ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY'])expect(run!.env).not.toContain(name);
   expect(run!.env).toContain('HOME');
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 });

 it('fails fast with a clear message when no Claude session is logged in',async()=>{
  const fake=fakeClaude('logged-out');
  const events=await collect(new ClaudeCodeAdapter({executable:fake.executable}).run({executionId:'e2',workingDirectory:fake.work,prompt:'x'}));
  expect(events).toEqual([expect.objectContaining({type:'EXECUTION_FAILED',errorCode:'CLAUDE_NOT_AUTHENTICATED'})]);
  expect(fake.invocations().map(item=>item.args[0])).toEqual(['auth']);
 });

 it('cancels with SIGINT so the CLI can close the turn with its own result',async()=>{
  const fake=fakeClaude('wait-sigint');const adapter=new ClaudeCodeAdapter({executable:fake.executable});
  const events=await collect(adapter.run({executionId:'e3',workingDirectory:fake.work,prompt:'x'}),event=>{if(event.type==='SESSION_INITIALIZED')void adapter.cancel('e3');});
  expect(events.at(-1)).toMatchObject({type:'EXECUTION_FAILED',errorCode:'CLAUDE_ABORTED_STREAMING'});
 });

 it('falls back to SIGTERM when the CLI ignores SIGINT',async()=>{
  const fake=fakeClaude('ignore-sigint');const adapter=new ClaudeCodeAdapter({executable:fake.executable,cancelGraceMs:200});
  const events=await collect(adapter.run({executionId:'e4',workingDirectory:fake.work,prompt:'x'}),event=>{if(event.type==='SESSION_INITIALIZED')void adapter.cancel('e4');});
  expect(events.at(-1)).toMatchObject({type:'EXECUTION_FAILED',errorCode:'CLAUDE_CANCELLED'});
 });
});

describe('Claude Code wired through the workspace core',()=>{
 it('seeds the Claude profile with models, runs the chosen model in a worktree and records the concrete model',async()=>{
  const fake=fakeClaude('replay');
  const repo=join(fake.root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet',repo]);
  execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});
  writeFileSync(join(repo,'src','base.ts'),'export const base = 1;\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});
  const workspaceRoot=join(fake.root,'workspace');
  const core=createWorkspaceCore(workspaceRoot,()=>undefined,{agentAdapter:new ClaudeCodeAdapter({executable:fake.executable})});cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Claude',slug:'claude'}]}) as {id:string};
  const opened=await core.handle({channel:'project:open',args:[project.id]}) as {selectedEntityId:string};
  await core.handle({channel:'repository:configure',args:[project.id,repo]});
  const db=openDatabase({filename:join(workspaceRoot,'projects',project.id,'workspace.sqlite'),initialize:false});
  try{
   db.prepare(`INSERT INTO knowledge_entities(id,project_id,entity_type,display_key,title,summary,status,parent_id,created_revision,updated_revision,created_at,updated_at) VALUES('task-1',?,'WORK_ITEM','TASK-001','Say hello','Create src/hello.ts','READY',?,1,1,'now','now')`).run(project.id,opened.selectedEntityId);
   db.prepare(`INSERT INTO work_items(entity_id,work_type,priority,acceptance_criteria_json,recommended_profile_role) VALUES('task-1','TASK','HIGH','[]','DEVELOPER')`).run();
  }finally{closeDatabase(db);}
  const profiles=await core.handle({channel:'agent:list_profiles',args:[project.id]}) as Array<{id:string;roleKey:string;name:string;providerName:string;defaultModel:string|null;availableModels:string[]}>;
  const developer=profiles.find(item=>item.roleKey==='DEVELOPER')!;
  expect(developer).toMatchObject({name:'Desarrollador Claude Code',providerName:'Claude Code CLI',defaultModel:'sonnet',availableModels:['haiku','sonnet','opus']});
  await expect(core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId:'task-1',profileId:developer.id,model:'gpt-5'}]})).rejects.toThrow('no está disponible');
  const started=await core.handle({channel:'execution:start',args:[{projectId:project.id,workItemId:'task-1',profileId:developer.id,model:'haiku'}]}) as {id:string;branchOrWorktree:string;modelUsed:string};
  expect(started.modelUsed).toBe('haiku');
  const done=await waitForStatus(core,project.id,started.id,'COMPLETED');
  expect(done.modelUsed).toBe('claude-haiku-5-5');
  expect(readFileSync(join(started.branchOrWorktree,'src','hello.ts'),'utf8')).toContain('hello');
  expect(existsSync(join(repo,'src','hello.ts'))).toBe(false);
  const run=fake.invocations().find(item=>item.args[0]==='-p')!;
  expect(run.args).toEqual(expect.arrayContaining(['--model','haiku']));
  expect(run.args[run.args.indexOf('--disallowedTools')+1]).toContain('Read(**/.env*)');
  expect(run.cwd).toBe(started.branchOrWorktree);
 });
});

async function waitForStatus(core:ReturnType<typeof createWorkspaceCore>,projectId:string,executionId:string,status:string){
 for(let attempt=0;attempt<100;attempt+=1){
  const executions=await core.handle({channel:'execution:list',args:[projectId]}) as Array<{id:string;status:string;modelUsed:string|null;resultSummary:string|null}>;
  const current=executions.find(item=>item.id===executionId);
  if(current?.status===status)return current;
  if(current&&['FAILED','CANCELLED','COMPLETED'].includes(current.status))throw new Error(`Execution ended as ${current.status}: ${current.resultSummary}`);
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw new Error(`Execution never reached ${status}`);
}
