import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeChangeSetPlanner } from '../../src/infrastructure/ai/claude-change-set-planner.js';
import { plainSchema } from '../../src/infrastructure/ai/change-set-planning-contract.js';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { createRequestDispatcher } from '../../src/infrastructure/ipc/sidecar/request-dispatcher.js';
import { ClaudeCodeAdapter } from '../../src/infrastructure/ai/claude-code-adapter.js';

const roots:string[]=[];const cores:Array<ReturnType<typeof createWorkspaceCore>>=[];const savedPath=process.env.GRAPHDEV_CLAUDE_PATH;
afterEach(()=>{for(const core of cores.splice(0))core.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});if(savedPath===undefined)delete process.env.GRAPHDEV_CLAUDE_PATH;else process.env.GRAPHDEV_CLAUDE_PATH=savedPath;});

const draft={title:'Auth',rationale:'Group login work.',operations:[
 {type:'CREATE_MODULE',tempId:'$auth',title:'Auth',purpose:'Authentication',summary:'Login and sessions.'},
 {type:'CREATE_FEATURE',tempId:'$login',moduleId:'$auth',title:'Login',priority:'HIGH'},
]};

/** Fake `claude`: behaviour chosen by a `mode` file next to it; logs argv and stdin. */
const FAKE_CLAUDE=`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const dir=__dirname,mode=fs.readFileSync(path.join(dir,'mode'),'utf8').trim(),args=process.argv.slice(2);
fs.appendFileSync(path.join(dir,'invocations.jsonl'),JSON.stringify({args})+'\\n');
const finish=v=>process.stdout.write(JSON.stringify(v)+'\\n',()=>process.exit(0));
if(args[0]==='auth'){finish({loggedIn:mode!=='logged-out'});return;}
let stdin='';process.stdin.on('data',c=>stdin+=c);process.stdin.on('end',()=>{
 fs.writeFileSync(path.join(dir,'prompt.txt'),stdin);
 const base={type:'result',subtype:'success',is_error:false,result:'',session_id:'s'};
 if(mode==='ok')finish({...base,structured_output:${JSON.stringify(draft)}});
 else if(mode==='no-output')finish(base);
 else if(mode==='api-error')finish({...base,subtype:'error_during_execution',is_error:true,result:'Overloaded'});
 else if(mode==='slow'){process.on('SIGINT',()=>process.exit(130));setTimeout(()=>finish({...base,structured_output:${JSON.stringify(draft)}}),Number(fs.readFileSync(path.join(dir,'delay'),'utf8')));}
});
`;

function fakeClaude(mode:string,delayMs=0){
 const root=mkdtempSync(join(tmpdir(),'graphdev2-planner-'));roots.push(root);
 const bin=join(root,'bin');mkdirSync(bin);const executable=join(bin,'claude');
 writeFileSync(executable,FAKE_CLAUDE);chmodSync(executable,0o755);writeFileSync(join(bin,'mode'),mode);writeFileSync(join(bin,'delay'),String(delayMs));
 const runs=()=>existsSync(join(bin,'invocations.jsonl'))?readFileSync(join(bin,'invocations.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>(JSON.parse(line) as {args:string[]}).args).filter(args=>args[0]==='-p'):[];
 return {root,executable,runs,prompt:()=>readFileSync(join(bin,'prompt.txt'),'utf8')};
}
const input={prompt:'Add authentication',project:{name:'P',description:null,rules:[],revision:1},focusEntity:null,entities:[],relationships:[]};

describe('ClaudeChangeSetPlanner',()=>{
 it('asks for structured output with a plain schema, no tools and the planning model, and normalizes the draft',async()=>{
  const fake=fakeClaude('ok');
  const result=await new ClaudeChangeSetPlanner(fake.root,{executable:fake.executable,defaultModel:'opus'}).propose(input);
  expect(result.title).toBe('Auth');
  expect(result.operations).toEqual([expect.objectContaining({type:'CREATE_MODULE',tempId:'$auth',purpose:'Authentication'}),expect.objectContaining({type:'CREATE_FEATURE',moduleId:'$auth',priority:'HIGH'})]);
  const args=fake.runs()[0]!;
  expect(args.slice(0,3)).toEqual(['-p','--output-format','json']);
  expect(JSON.parse(args[args.indexOf('--json-schema')+1]!)).toEqual(plainSchema);
  expect(args[args.indexOf('--tools')+1]).toBe('');
  expect(args[args.indexOf('--model')+1]).toBe('opus');
  expect(fake.prompt()).toContain('Add authentication');
 });

 it('uses the model from the request over the default',async()=>{
  const fake=fakeClaude('ok');
  await new ClaudeChangeSetPlanner(fake.root,{executable:fake.executable,defaultModel:'opus'}).propose({...input,model:'haiku'});
  expect(fake.runs()[0]).toEqual(expect.arrayContaining(['--model','haiku']));
 });

 it.each([
  ['no-output','sin una propuesta estructurada'],
  ['api-error','no pudo proponer cambios: Overloaded'],
  ['logged-out','no tiene una sesión iniciada'],
 ])('explains the failure when the CLI answers %s',async(mode,message)=>{
  const fake=fakeClaude(mode);
  await expect(new ClaudeChangeSetPlanner(fake.root,{executable:fake.executable}).propose(input)).rejects.toThrow(message);
 });

 it('stops the CLI and reports its own timeout',async()=>{
  const fake=fakeClaude('slow',5_000);
  await expect(new ClaudeChangeSetPlanner(fake.root,{executable:fake.executable,timeoutMs:300}).propose(input)).rejects.toThrow('superó el límite');
 });

 it('keeps the plain schema free of null types',()=>{
  expect(JSON.stringify(plainSchema)).not.toContain('null');
  expect(plainSchema.properties.operations.items.required).toEqual(['type']);
 });
});

describe('ChangeSet proposals through the workspace core',()=>{
 it('validates the requested model and passes it to Claude',async()=>{
  const fake=fakeClaude('ok');process.env.GRAPHDEV_CLAUDE_PATH=fake.executable;
  const core=createWorkspaceCore(join(fake.root,'workspace'),()=>undefined,{agentAdapter:new ClaudeCodeAdapter()});cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Plan',slug:'plan'}]}) as {id:string};
  await core.handle({channel:'project:open',args:[project.id]});
  await expect(core.handle({channel:'changeset:propose_from_chat',args:[project.id,'Add auth',undefined,undefined,'gpt-5']})).rejects.toThrow('no está disponible para planificar');
  const proposal=await core.handle({channel:'changeset:propose_from_chat',args:[project.id,'Add auth',undefined,undefined,'haiku']}) as {title:string;status:string};
  expect(proposal).toMatchObject({title:'Auth'});
  expect(fake.runs().at(-1)).toEqual(expect.arrayContaining(['--model','haiku']));
  await core.handle({channel:'changeset:propose_from_chat',args:[project.id,'Add auth again']});
  expect(fake.runs().at(-1)).toEqual(expect.arrayContaining(['--model','opus']));
 });

 it('answers other requests while a slow proposal is running (D1)',async()=>{
  const fake=fakeClaude('slow',1_500);process.env.GRAPHDEV_CLAUDE_PATH=fake.executable;
  const core=createWorkspaceCore(join(fake.root,'workspace'),()=>undefined,{agentAdapter:new ClaudeCodeAdapter()});cores.push(core);
  const project=await core.handle({channel:'project:create',args:[{name:'Slow',slug:'slow'}]}) as {id:string};
  await core.handle({channel:'project:open',args:[project.id]});
  const answered:Array<{id:string;at:number}>=[];const started=Date.now();
  const dispatcher=createRequestDispatcher(core,value=>answered.push({id:(value as {id:string}).id,at:Date.now()-started}));
  dispatcher.dispatch(JSON.stringify({id:'propose',request:{channel:'changeset:propose_from_chat',args:[project.id,'Add auth']}}));
  dispatcher.dispatch(JSON.stringify({id:'list',request:{channel:'project:list',args:[]}}));
  dispatcher.dispatch(JSON.stringify({id:'graph',request:{channel:'graph:get_view',args:[project.id]}}));
  await dispatcher.drain();
  expect(answered.map(item=>item.id)).toEqual(['list','graph','propose']);
  expect(answered[0]!.at).toBeLessThan(1_000);expect(answered[2]!.at).toBeGreaterThanOrEqual(1_400);
 });
});
