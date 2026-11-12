import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, readdir, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { git } from '../git/git-isolation-service.js';
import type { AutonomyPolicy } from '../../domain/governance/models.js';
import type { ExecutionValidatorPort, WorkspaceEnvironmentPort } from '../../application/ports/agent-execution-port.js';
import type { ProjectEnvironment } from '../../domain/projects/stack-catalog.js';
import { qualityFlags } from '../../domain/work-management/quality-flags.js';

const execFileAsync=promisify(execFile);
type GitRunner=(args:string[])=>Promise<string>;

/** Captures the isolated diff, audits every changed path and runs only policy-allowlisted checks. */
export class ExecutionValidator implements ExecutionValidatorPort {
 /** `environment` (plan S2) reconciles the dependencies the app installs; without it a run with an environment fails closed. */
 constructor(private readonly workspaceRoot:string,private readonly recordDiffs:(executionId:string,repositoryId:string,diffs:ExecutionFileDiff[])=>void,private readonly environment:Pick<WorkspaceEnvironmentPort,'reconcile'>|null=null){}

 async validate(input:{projectId:string;executionId:string;workingDirectory:string;repositoryRoot:string;repositoryId:string;initialCommit:string;policy:AutonomyPolicy;commitMessage?:string;environment?:ProjectEnvironment;ownedPaths?:string[]}) {
  if(!/^[a-f0-9-]{36}$/i.test(input.projectId)||!/^[a-f0-9-]{36}$/i.test(input.executionId))throw new Error('Invalid identifiers for execution artifact paths.');
  const worktree=input.workingDirectory,policy=input.policy;
  // The worktree is agent-writable, so its `.git` pointer and any config it leads to are untrusted.
  // Resolve the admin directory from the main repository and pin every Git call to it.
  const gitDir=await resolveWorktreeGitDir(input.repositoryRoot,worktree);
  const pointerTampered=await restoreGitPointer(worktree,gitDir);
  const run:GitRunner=args=>pinnedGit(worktree,gitDir,args);

  const tracked=splitNul(await run(['diff','--name-only','-z',input.initialCommit,'--']));
  // Plan S2: what the app installed (node_modules) is the environment, not the agent's work; the agent may not touch npm's config.
  const environmentPaths=[...(input.environment?.paths??[]),...(input.ownedPaths??[])],isEnvironment=(path:string)=>environmentPaths.some(root=>path===root||path.startsWith(`${root}/`));
  const untracked=splitNul(await run(['ls-files','--others','--exclude-standard','-z'])).filter(path=>!isEnvironment(safeRepoPath(path)));
  const ignored=splitNul(await run(['ls-files','--others','--ignored','--exclude-standard','--directory','-z'])).filter(path=>!isEnvironment(safeRepoPath(path)));
  const paths=[...new Set([...tracked,...untracked])].map(safeRepoPath);
  const ignoredPaths=[...new Set(ignored.map(safeRepoPath))];
  const policyViolations=[...new Set([...paths,...ignoredPaths])].filter(path=>isDenied(path,policy.deniedPaths)||isReadOnly(path,policy.readonlyPaths)||!matchesAny(path,policy.writablePaths)||isEnvironment(path)||(input.environment!==undefined&&/(^|\/)\.npmrc$/i.test(path)));
  const symlinkViolations=await auditSymlinks(worktree,paths,policy);
  const violations=[...new Set([...(pointerTampered?['.git']:[]),...policyViolations,...symlinkViolations])];

  // Denied paths may hold secrets: never stage them nor copy their content into the patch or diff rows.
  const denied=new Set(paths.filter(path=>isDenied(path,policy.deniedPaths)));
  const auditable=paths.filter(path=>!denied.has(path));
  const stageable=untracked.map(safeRepoPath).filter(path=>!denied.has(path));
  if(stageable.length) await run(['add','-N','--',...stageable]);
  const patch=auditable.length?await run(['diff','--no-ext-diff','--binary',input.initialCommit,'--',...auditable]):'';
  const executionDirectory=join(this.workspaceRoot,'projects',input.projectId,'executions',input.executionId);
  await mkdir(executionDirectory,{recursive:true});
  await writeFile(join(executionDirectory,'changes.patch'),patch,'utf8');
  const diffRows=await this.readDiffRows(run,worktree,input.initialCommit,auditable,untracked);
  const deniedRows=await Promise.all([...denied].map(async filePath=>({filePath,changeType:await redactedChangeType(worktree,filePath,untracked.includes(filePath)),additions:0,deletions:0,diffPatch:null})));
  const ignoredViolationRows=violations.filter(path=>ignoredPaths.includes(path)&&!paths.includes(path)).map(filePath=>({filePath,changeType:'ADDED' as const,additions:0,deletions:0,diffPatch:null}));
  this.recordDiffs(input.executionId,input.repositoryId,[...diffRows,...deniedRows,...ignoredViolationRows]);
  if(violations.length){
   await this.revertPaths(run,worktree,input.initialCommit,violations.filter(path=>path!=='.git'),[...untracked,...ignoredPaths]);
   const resultSummary=`Sandbox audit failed. Unauthorized paths: ${violations.join(', ')}`;
   await writeFile(join(executionDirectory,'test-output.log'),`${resultSummary}\n`,'utf8');
   return {passed:false,finalCommit:null,resultSummary,testSummary:{passed:false,reason:'SANDBOX_POLICY_VIOLATION',violations,patchPath:'changes.patch',testLogPath:'test-output.log'}};
  }
  let environmentLog='';
  if(input.environment){
   const baseManifest=await run(['show',`${input.initialCommit}:package.json`]).catch(()=>null);
   const reconciled=this.environment?await this.environment.reconcile({workingDirectory:worktree,baseManifest,environment:input.environment}):{ok:false as const,reason:'ENVIRONMENT' as const,unapproved:[],log:'No hay un gestor del entorno para reinstalar las dependencias.'};
   if(!reconciled.ok){
    await writeFile(join(executionDirectory,'test-output.log'),`${reconciled.log}\n`,'utf8');
    const resultSummary=reconciled.reason==='DEPENDENCY_APPROVAL'?`Dependencias sin aprobar: ${reconciled.unapproved.join(', ')}. Apruébalas para que la app las instale, o pide otro enfoque.`:`No se pudo preparar el entorno: ${reconciled.log}`;
    return {passed:false,finalCommit:null,resultSummary,testSummary:{passed:false,reason:reconciled.reason,packages:reconciled.unapproved,patchPath:'changes.patch',testLogPath:'test-output.log'}};
   }
   environmentLog=reconciled.log?`${reconciled.log}\n\n`:'';
  }
  const testReport=await this.runAllowedChecks(worktree,policy.allowedCommands);
  await writeFile(join(executionDirectory,'test-output.log'),environmentLog+testReport.log,'utf8');
  const failed=testReport.results.find(result=>result.exitCode!==0);
  // Accepted work is committed on the execution branch so it can be reviewed and merged as a unit.
  if(!failed&&input.commitMessage)await commitAll(run,input.commitMessage,environmentPaths);
  const finalCommit=(await run(['rev-parse','HEAD'])).trim();
  // Plan S5: what may have weakened the verification goes with the result; the autopilot does not accept it on its own.
  const flags=qualityFlags(diffRows);
  return {passed:!failed,finalCommit,resultSummary:failed?`Verification command failed: ${failed.command}`:'Diff audit passed.'+(testReport.results.length?' Configured checks passed.':' No verification commands are allowlisted.'),testSummary:{passed:!failed,commands:testReport.results,skipped:testReport.results.length===0,patchPath:'changes.patch',testLogPath:'test-output.log',...(flags.length?{qualityFlags:flags}:{})}};
 }

 private async readDiffRows(run:GitRunner,cwd:string,base:string,paths:string[],untracked:string[]):Promise<ExecutionFileDiff[]> {
  if(!paths.length)return [];
  const numstat=splitNul(await run(['diff','--numstat','-z',base,'--',...paths]));
  const counts=new Map<string,{additions:number;deletions:number}>();
  // Git's -z numstat encodes each record as add<TAB>del<TAB>path\0.
  for(const row of numstat){const fields=row.split('\t');if(fields.length<3)continue;counts.set(fields.slice(2).join('\t'),{additions:Number(fields[0])||0,deletions:Number(fields[1])||0});}
  return Promise.all(paths.map(async path=>{
   const count=counts.get(path)??{additions:0,deletions:0};
   const exists=await lstat(join(cwd,...path.split('/'))).then(()=>true,()=>false);
   const existed=untracked.includes(path)?false:await run(['cat-file','-e',`${base}:${path}`]).then(()=>true,()=>false);
   const changeType=!existed&&exists?'ADDED':existed&&exists?'MODIFIED':'DELETED';
   const diffPatch=await run(['diff','--no-ext-diff','--binary',base,'--',path]);
   return {filePath:path,changeType,additions:count.additions,deletions:count.deletions,diffPatch};
  }));
 }

 private async revertPaths(run:GitRunner,cwd:string,base:string,violations:string[],untracked:string[]):Promise<void> {
  const remove=violations.filter(path=>untracked.includes(path));
  const restore=violations.filter(path=>!untracked.includes(path));
  if(restore.length)await run(['restore','--source',base,'--staged','--worktree','--',...restore]);
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

/**
 * Commits every non-ignored change. Uses the repository's identity when configured, otherwise a neutral one.
 * Hooks stay disabled (see pinnedGit): the audit and the policy's checks are the gate, not repository hooks.
 */
async function commitAll(run:GitRunner,message:string,excluded:string[]=[]):Promise<void> {
 // The environment (node_modules) is never committed, even in a repository whose .gitignore forgot it.
 // Git runs with --literal-pathspecs (no :(exclude) magic): stage everything, then unstage the environment.
 await run(['add','-A']);
 if(excluded.length)await run(['reset','--quiet','--',...excluded]);
 if(await run(['diff','--cached','--quiet']).then(()=>true,()=>false))return;
 const hasIdentity=await run(['config','user.email']).then(value=>Boolean(value.trim()),()=>false);
 const identity=hasIdentity?[]:['-c','user.name=Graph Workspace','-c','user.email=graph-workspace@localhost'];
 await run([...identity,'commit','--no-verify','--quiet','-m',message]);
}

/** Runs Git against the trusted admin directory with repository-controlled command hooks disabled. */
function pinnedGit(worktree:string,gitDir:string,args:string[]):Promise<string> {
 return git(worktree,['--git-dir',gitDir,'--work-tree',worktree,'--literal-pathspecs','-c','core.fsmonitor=false','-c',`core.hooksPath=${join(gitDir,'graphdev-no-hooks')}`,...args]);
}

/** Finds the worktree's admin directory by asking the main repository, never the worktree itself. */
async function resolveWorktreeGitDir(repositoryRoot:string,worktree:string):Promise<string> {
 const commonDir=(await git(repositoryRoot,['-c','core.fsmonitor=false','rev-parse','--path-format=absolute','--git-common-dir'])).trim();
 const expected=await realpath(worktree);
 const entries=await readdir(join(commonDir,'worktrees'),{withFileTypes:true}).catch(()=>[]);
 for(const entry of entries){
  if(!entry.isDirectory())continue;
  const adminDir=join(commonDir,'worktrees',entry.name);
  const pointer=(await readFile(join(adminDir,'gitdir'),'utf8').catch(()=>'')).trim();
  if(!pointer)continue;
  const registered=await realpath(dirname(pointer)).catch(()=>null);
  if(registered===expected)return adminDir;
 }
 throw new Error(`The execution worktree is not registered in the configured repository: ${worktree}`);
}

/** Returns true when the agent replaced or edited the worktree `.git` pointer, after restoring it. */
async function restoreGitPointer(worktree:string,gitDir:string):Promise<boolean> {
 const pointerPath=join(worktree,'.git');
 const info=await lstat(pointerPath).catch(()=>null);
 if(info?.isFile()){
  const content=await readFile(pointerPath,'utf8');
  const match=/^gitdir: (.+)\n?$/.exec(content);
  if(match&&await realpath(match[1]!).catch(()=>null)===await realpath(gitDir))return false;
 }
 await rm(pointerPath,{recursive:true,force:true});
 await writeFile(pointerPath,`gitdir: ${gitDir}\n`,'utf8');
 return true;
}

/** Flags changed symlinks that leave the worktree or reach `.git`, denied or read-only paths. */
async function auditSymlinks(worktree:string,paths:string[],policy:AutonomyPolicy):Promise<string[]> {
 const root=await realpath(worktree);
 const violations:string[]=[];
 for(const path of paths){
  const absolute=join(root,...path.split('/'));
  const info=await lstat(absolute).catch(()=>null);
  if(!info?.isSymbolicLink())continue;
  const literal=resolve(dirname(absolute),await readlink(absolute));
  const target=await realpath(absolute).catch(()=>literal);
  const targets=[literal,target].map(item=>relative(root,item));
  const unsafe=await Promise.all(targets.map(async rel=>{
   if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))return true;
   const repoPath=rel.split(sep).join('/');
   if(repoPath==='.git'||repoPath.startsWith('.git/'))return true;
   const isDirectory=await stat(join(root,rel)).then(item=>item.isDirectory(),()=>false);
   const candidates=isDirectory?[repoPath,`${repoPath}/`]:[repoPath];
   return candidates.some(candidate=>isDenied(candidate,policy.deniedPaths)||isReadOnly(candidate,policy.readonlyPaths));
  }));
  if(unsafe.some(Boolean))violations.push(path);
 }
 return violations;
}

async function redactedChangeType(worktree:string,path:string,isUntracked:boolean):Promise<ExecutionFileDiff['changeType']> {
 const exists=await lstat(join(worktree,...path.split('/'))).then(()=>true,()=>false);
 return isUntracked?'ADDED':exists?'MODIFIED':'DELETED';
}

function splitNul(value:string):string[]{return value.split('\0').filter(Boolean);}
function safeRepoPath(path:string):string {const normalized=path.replaceAll('\\','/').replace(/\/+$/,'');if(!normalized||normalized.startsWith('/')||normalized.split('/').some(part=>part==='..'))throw new Error(`Git returned an unsafe path: ${path}`);return normalized;}
// Denied paths are matched case-insensitively so `.ENV` cannot dodge `.env*` on case-insensitive filesystems.
function isDenied(path:string,patterns:string[]):boolean{return matchesAny(path,patterns,'i');}
function isReadOnly(path:string,patterns:string[]):boolean{return matchesAny(path,patterns);}
function matchesAny(path:string,patterns:string[],flags=''):boolean{return patterns.some(pattern=>glob(pattern,flags).test(path));}

/**
 * Compiles a policy pattern with gitignore-like semantics:
 * - a pattern without `/` (`.env*`) matches that name at any depth, and everything beneath it;
 * - a pattern with `/` (or a leading `/`) is anchored at the repository root;
 * - `dir/**` also matches `dir` itself, because Git reports untracked ignored directories collapsed;
 * - `**` crosses directories, `*` and `?` stay within one path segment.
 */
export function glob(pattern:string,flags=''):RegExp {
 const trimmed=pattern.trim().replace(/\/+$/,'');
 const anchored=trimmed.includes('/');
 let body=trimmed.replace(/^\/+/,'');
 const coversDirectory=body.endsWith('/**');
 if(coversDirectory)body=body.slice(0,-3);
 const translated=body.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('**/','\u0001').replaceAll('**','\u0000').replaceAll('*','[^/]*').replaceAll('?','[^/]').replaceAll('\u0001','(?:.*/)?').replaceAll('\u0000','.*');
 const source=anchored?`^${translated}${coversDirectory?'(?:/.*)?':''}$`:`^(?:.*/)?${translated}(?:/.*)?$`;
 return new RegExp(source,flags);
}
function parseCommand(command:string):string[]{
 if(/[;&|`$<>\n\r]/.test(command))throw new Error(`Shell operators are not allowed in verification commands: ${command}`);
 const tokens=command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)??[];
 return tokens.map(token=>token.replace(/^(?:"([^"]*)"|'([^']*)')$/,'$1$2'));
}
