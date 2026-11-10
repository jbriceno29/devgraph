import { afterEach,describe,expect,it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync } from 'node:fs';
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

function repository():string {
 const root=mkdtempSync(join(tmpdir(),'graphdev2-validation-'));roots.push(root);const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});execFileSync('git',['init','--quiet',repo]);execFileSync('git',['config','user.name','Graphdev Tests'],{cwd:repo});execFileSync('git',['config','user.email','tests@graphdev.local'],{cwd:repo});writeFileSync(join(repo,'src','base.ts'),'export const base = true;\n');execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['commit','--quiet','-m','base'],{cwd:repo});return root;
}
