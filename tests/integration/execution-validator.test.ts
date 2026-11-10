import { afterEach,describe,expect,it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ExecutionValidator } from '../../src/infrastructure/execution/execution-validator.js';
import type { AutonomyPolicy } from '../../src/domain/governance/models.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const policy:AutonomyPolicy={id:'policy',projectId:'11111111-1111-4111-8111-111111111111',name:'test',writablePaths:['src/**'],readonlyPaths:['docs/adr/**'],deniedPaths:['.env*'],allowedCommands:[],autoApproveScopes:[],requireWorktreeIsolation:true};

describe('ExecutionValidator',()=>{
 it('fails and reverts denied paths while preserving an audit patch and log',async()=>{
  const root=repository(),workspace=join(root,'workspace'),id='22222222-2222-4222-8222-222222222222',projectId=policy.projectId;
  writeFileSync(join(root,'repo','.gitignore'),'.env.local\n');
  execFileSync('git',['add','.'],{cwd:join(root,'repo')});execFileSync('git',['commit','--quiet','-m','add protected file'],{cwd:join(root,'repo')});
  const base=execFileSync('git',['rev-parse','HEAD'],{cwd:join(root,'repo'),encoding:'utf8'}).trim();
  const worktree=join(workspace,'projects',projectId,'worktrees',id);mkdirSync(dirname(worktree),{recursive:true});
  execFileSync('git',['worktree','add','--detach','--quiet',worktree,base],{cwd:join(root,'repo')});
  writeFileSync(join(worktree,'.env.local'),'secret=changed\n');writeFileSync(join(worktree,'config.secret'),'no\n');writeFileSync(join(worktree,'src','allowed.ts'),'export const ok = true;\n');
  const recorded:Array<{filePath:string}>=[];
  const validator=new ExecutionValidator(workspace,(_executionId,_repositoryId,diffs)=>recorded.push(...diffs));
  const result=await validator.validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy});
  expect(result.passed).toBe(false);expect(result.testSummary).toMatchObject({reason:'SANDBOX_POLICY_VIOLATION'});expect((result.testSummary as {violations:string[]}).violations).toEqual(expect.arrayContaining(['.env.local','config.secret']));
  expect(existsSync(join(worktree,'.env.local'))).toBe(false);expect(existsSync(join(worktree,'config.secret'))).toBe(false);
  expect(existsSync(join(worktree,'src','allowed.ts'))).toBe(true);expect(recorded.map(item=>item.filePath)).toEqual(expect.arrayContaining(['.env.local','config.secret','src/allowed.ts']));
  expect(readFileSync(join(workspace,'projects',projectId,'executions',id,'changes.patch'),'utf8')).not.toContain('secret=changed');
  expect(readFileSync(join(workspace,'projects',projectId,'executions',id,'test-output.log'),'utf8')).toContain('Sandbox audit failed');
 });

 it('accepts allowed paths and records the final commit plus the patch',async()=>{
  const root=repository(),workspace=join(root,'workspace'),id='33333333-3333-4333-8333-333333333333',projectId=policy.projectId;
  const base=execFileSync('git',['rev-parse','HEAD'],{cwd:join(root,'repo'),encoding:'utf8'}).trim();
  const worktree=join(workspace,'projects',projectId,'worktrees',id);mkdirSync(dirname(worktree),{recursive:true});execFileSync('git',['worktree','add','--detach','--quiet',worktree,base],{cwd:join(root,'repo')});
  writeFileSync(join(worktree,'src','feature.ts'),'export const feature = true;\n');
  const validator=new ExecutionValidator(workspace,()=>undefined);
  const result=await validator.validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy});
  expect(result).toMatchObject({passed:true,finalCommit:base,resultSummary:'Diff audit passed. No verification commands are allowlisted.'});
  expect(readFileSync(join(workspace,'projects',projectId,'executions',id,'changes.patch'),'utf8')).toContain('feature.ts');
  expect(existsSync(join(workspace,'projects',projectId,'executions',id,'test-output.log'))).toBe(true);
 });

 it('ignores a crafted .git pointer: never runs its fsmonitor command and restores the real pointer',async()=>{
  const {root,workspace,worktree,base,id,projectId}=isolated('55555555-5555-4555-8555-555555555555');
  const marker=join(root,'PWNED'),crafted=join(worktree,'src','crafted-git'),original=readFileSync(join(worktree,'.git'),'utf8');
  execFileSync('git',['clone','--quiet','--bare',join(root,'repo'),crafted]);
  writeFileSync(join(crafted,'config'),`[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = touch ${marker}; false\n`);
  writeFileSync(join(worktree,'.git'),`gitdir: ${crafted}\n`);
  const result=await new ExecutionValidator(workspace,()=>undefined).validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy});
  expect(existsSync(marker)).toBe(false);
  expect(result.passed).toBe(false);expect((result.testSummary as {violations:string[]}).violations).toContain('.git');
  expect(readFileSync(join(worktree,'.git'),'utf8')).toBe(original);
 });

 it('rejects changed symlinks that escape the worktree or reach denied paths',async()=>{
  const {root,workspace,worktree,base,id,projectId}=isolated('66666666-6666-4666-8666-666666666666');
  writeFileSync(join(root,'outside.txt'),'outside\n');
  symlinkSync(join(root,'outside.txt'),join(worktree,'src','outside-link'));symlinkSync('/',join(worktree,'src','root-link'));
  symlinkSync('../.env',join(worktree,'src','env-link'));symlinkSync('base.ts',join(worktree,'src','inside-link'));
  const result=await new ExecutionValidator(workspace,()=>undefined).validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy});
  const violations=(result.testSummary as {violations:string[]}).violations;
  expect(result.passed).toBe(false);expect(violations).toEqual(expect.arrayContaining(['src/outside-link','src/root-link','src/env-link']));expect(violations).not.toContain('src/inside-link');
  expect(existsSync(join(worktree,'src','outside-link'))).toBe(false);expect(existsSync(join(root,'outside.txt'))).toBe(true);
 });

 it('never copies the content of untracked denied files into the patch or diff rows',async()=>{
  const {root,workspace,worktree,base,id,projectId}=isolated('77777777-7777-4777-8777-777777777777');
  writeFileSync(join(worktree,'.env'),'TOKEN=super-secret\n');writeFileSync(join(worktree,'src','ok.ts'),'export const ok = 1;\n');
  const recorded:Array<{filePath:string;diffPatch:string|null}>=[];
  const result=await new ExecutionValidator(workspace,(_e,_r,diffs)=>recorded.push(...diffs)).validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy});
  expect(result.passed).toBe(false);
  const patch=readFileSync(join(workspace,'projects',projectId,'executions',id,'changes.patch'),'utf8');
  expect(patch).not.toContain('super-secret');expect(patch).toContain('ok.ts');
  expect(recorded.find(row=>row.filePath==='.env')).toMatchObject({diffPatch:null,changeType:'ADDED'});
  expect(JSON.stringify(recorded)).not.toContain('super-secret');expect(existsSync(join(worktree,'.env'))).toBe(false);
 });

 it('runs only commands listed in the autonomy policy and writes their output',async()=>{
  const root=repository(),workspace=join(root,'workspace'),id='44444444-4444-4444-8444-444444444444',projectId=policy.projectId;
  const base=execFileSync('git',['rev-parse','HEAD'],{cwd:join(root,'repo'),encoding:'utf8'}).trim();
  const worktree=join(workspace,'projects',projectId,'worktrees',id);mkdirSync(dirname(worktree),{recursive:true});execFileSync('git',['worktree','add','--detach','--quiet',worktree,base],{cwd:join(root,'repo')});
  const validator=new ExecutionValidator(workspace,()=>undefined);
  const result=await validator.validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy:{...policy,allowedCommands:['node --version']}});
  expect(result.passed).toBe(true);expect(result.testSummary).toMatchObject({skipped:false,commands:[{command:'node --version',exitCode:0}]});
  expect(readFileSync(join(workspace,'projects',projectId,'executions',id,'test-output.log'),'utf8')).toContain(process.versions.node);
  await expect(validator.validate({projectId,executionId:id,workingDirectory:worktree,repositoryRoot:join(root,'repo'),repositoryId:'repo-id',initialCommit:base,policy:{...policy,allowedCommands:['node --version; touch /tmp/should-not-run']}})).rejects.toThrow('Shell operators are not allowed');
 });
});

function isolated(id:string){
 const root=repository(),workspace=join(root,'workspace'),projectId=policy.projectId;
 const base=execFileSync('git',['rev-parse','HEAD'],{cwd:join(root,'repo'),encoding:'utf8'}).trim();
 const worktree=join(workspace,'projects',projectId,'worktrees',id);mkdirSync(dirname(worktree),{recursive:true});
 execFileSync('git',['worktree','add','--detach','--quiet',worktree,base],{cwd:join(root,'repo')});
 return {root,workspace,worktree,base,id,projectId};
}

function repository():string {
 const root=mkdtempSync(join(tmpdir(),'graphdev2-validation-'));roots.push(root);const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet',repo]);execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});writeFileSync(join(repo,'src','base.ts'),'export const base = true;\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});return root;
}
