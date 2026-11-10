import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../git/git-isolation-service.js';
import type { AutonomyPolicy } from '../../domain/governance/models.js';
import type { ExecutionValidatorPort } from '../../application/ports/agent-execution-port.js';

const execFileAsync=promisify(execFile);

/** Captures the isolated diff, audits every changed path and runs only policy-allowlisted checks. */
export class ExecutionValidator implements ExecutionValidatorPort {
 constructor(private readonly workspaceRoot:string,private readonly recordDiffs:(executionId:string,repositoryId:string,diffs:ExecutionFileDiff[])=>void){}

 async validate(input:{projectId:string;executionId:string;workingDirectory:string;repositoryRoot:string;repositoryId:string;initialCommit:string;policy:AutonomyPolicy}) {
  if(!/^[a-f0-9-]{36}$/i.test(input.projectId)||!/^[a-f0-9-]{36}$/i.test(input.executionId))throw new Error('Invalid identifiers for execution artifact paths.');
  const worktree=input.workingDirectory;
  const tracked=splitNul(await git(worktree,['diff','--name-only','-z',input.initialCommit,'--']));
  const untracked=splitNul(await git(worktree,['ls-files','--others','--exclude-standard','-z']));
  const ignored=splitNul(await git(worktree,['ls-files','--others','--ignored','--exclude-standard','--directory','-z']));
  const paths=[...new Set([...tracked,...untracked])].map(safeRepoPath);
  const ignoredPaths=[...new Set(ignored.map(safeRepoPath))];
  const violations=[...new Set([...paths,...ignoredPaths])].filter(path=>isDenied(path,input.policy.deniedPaths)||isReadOnly(path,input.policy.readonlyPaths)||!matchesAny(path,input.policy.writablePaths));
  if(untracked.length) await git(worktree,['add','-N','--',...untracked]);
  const patch=await git(worktree,['diff','--no-ext-diff','--binary',input.initialCommit,'--']);
  const executionDirectory=join(this.workspaceRoot,'projects',input.projectId,'executions',input.executionId);
  await mkdir(executionDirectory,{recursive:true});
  await writeFile(join(executionDirectory,'changes.patch'),patch,'utf8');
  const diffRows=await this.readDiffRows(worktree,input.initialCommit,paths,untracked);
  const ignoredViolationRows=violations.filter(path=>ignoredPaths.includes(path)&&!paths.includes(path)).map(filePath=>({filePath,changeType:'ADDED' as const,additions:0,deletions:0,diffPatch:null}));
  this.recordDiffs(input.executionId,input.repositoryId,[...diffRows,...ignoredViolationRows]);
  if(violations.length){
   await this.revertPaths(worktree,input.initialCommit,violations,[...untracked,...ignoredPaths]);
   const resultSummary=`Sandbox audit failed. Unauthorized paths: ${violations.join(', ')}`;
   await writeFile(join(executionDirectory,'test-output.log'),`${resultSummary}\n`,'utf8');
   return {passed:false,finalCommit:null,resultSummary,testSummary:{passed:false,reason:'SANDBOX_POLICY_VIOLATION',violations,patchPath:'changes.patch',testLogPath:'test-output.log'}};
  }
  const testReport=await this.runAllowedChecks(worktree,input.policy.allowedCommands);
  await writeFile(join(executionDirectory,'test-output.log'),testReport.log,'utf8');
  const finalCommit=(await git(worktree,['rev-parse','HEAD'])).trim();
  const failed=testReport.results.find(result=>result.exitCode!==0);
  return {passed:!failed,finalCommit,resultSummary:failed?`Verification command failed: ${failed.command}`:'Diff audit passed.'+(testReport.results.length?' Configured checks passed.':' No verification commands are allowlisted.'),testSummary:{passed:!failed,commands:testReport.results,skipped:testReport.results.length===0,patchPath:'changes.patch',testLogPath:'test-output.log'}};
 }

 private async readDiffRows(cwd:string,base:string,paths:string[],untracked:string[]):Promise<ExecutionFileDiff[]> {
  if(!paths.length)return [];
  const numstat=splitNul(await git(cwd,['diff','--numstat','-z',base,'--']));
  const counts=new Map<string,{additions:number;deletions:number}>();
  // Git's -z numstat encodes each record as add<TAB>del<TAB>path\0.
  for(const row of numstat){const fields=row.split('\t');if(fields.length<3)continue;counts.set(fields.slice(2).join('\t'),{additions:Number(fields[0])||0,deletions:Number(fields[1])||0});}
  return Promise.all(paths.map(async path=>{
   const count=counts.get(path)??{additions:0,deletions:0};
   const exists=await stat(join(cwd,...path.split('/'))).then(()=>true,()=>false);
   const existed=untracked.includes(path)?false:await execFileAsync('git',['cat-file','-e',`${base}:${path}`],{cwd,windowsHide:true}).then(()=>true,()=>false);
   const changeType=!existed&&exists?'ADDED':existed&&exists?'MODIFIED':'DELETED';
   const diffPatch=await git(cwd,['diff','--no-ext-diff','--binary',base,'--',path]);
   return {filePath:path,changeType,additions:count.additions,deletions:count.deletions,diffPatch};
  }));
 }

 private async revertPaths(cwd:string,base:string,violations:string[],untracked:string[]):Promise<void> {
  const remove=violations.filter(path=>untracked.includes(path));
  const restore=violations.filter(path=>!untracked.includes(path));
  if(restore.length)await git(cwd,['restore','--source',base,'--staged','--worktree','--',...restore]);
  for(const path of remove)await rm(join(cwd,...path.split('/')),{recursive:true,force:true});
 }

 private async runAllowedChecks(cwd:string,commands:string[]) {
  const results:Array<{command:string;exitCode:number;output:string}>=[];
  for(const command of commands){
   const argv=parseCommand(command);
   if(!argv.length)throw new Error(`Invalid allowlisted command: ${command}`);
   try{const result=await execFileAsync(argv[0]!,argv.slice(1),{cwd,encoding:'utf8',timeout:120_000,maxBuffer:4*1024*1024,windowsHide:true});results.push({command,exitCode:0,output:result.stdout+result.stderr});}
   catch(error){const result=error as {code?:number;stdout?:string;stderr?:string;message?:string};results.push({command,exitCode:typeof result.code==='number'?result.code:1,output:`${result.stdout??''}${result.stderr??''}${result.message??''}`});}
  }
  const log=results.length?results.map(result=>`$ ${result.command}\n${result.output}\n[exit ${result.exitCode}]`).join('\n\n'):'No verification commands are configured in the autonomy policy.\n';
  return {results,log};
 }
}

export interface ExecutionFileDiff {filePath:string;changeType:'ADDED'|'MODIFIED'|'DELETED'|'RENAMED';additions:number;deletions:number;diffPatch:string|null}
function splitNul(value:string):string[]{return value.split('\0').filter(Boolean);}
function safeRepoPath(path:string):string {const normalized=path.replaceAll('\\','/').replace(/\/+$/,'');if(!normalized||normalized.startsWith('/')||normalized.split('/').some(part=>part==='..'))throw new Error(`Git returned an unsafe path: ${path}`);return normalized;}
function isDenied(path:string,patterns:string[]):boolean{return matchesAny(path,patterns);}
function isReadOnly(path:string,patterns:string[]):boolean{return matchesAny(path,patterns);}
function matchesAny(path:string,patterns:string[]):boolean{return patterns.some(pattern=>glob(pattern).test(path));}
function glob(pattern:string):RegExp {const escaped=pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('**','\u0000').replaceAll('*','[^/]*').replaceAll('?','[^/]').replaceAll('\u0000','.*');return new RegExp(`^${escaped}$`);}
function parseCommand(command:string):string[]{
 if(/[;&|`$<>\n\r]/.test(command))throw new Error(`Shell operators are not allowed in verification commands: ${command}`);
 const tokens=command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)??[];
 return tokens.map(token=>token.replace(/^(?:"([^"]*)"|'([^']*)')$/,'$1$2'));
}
