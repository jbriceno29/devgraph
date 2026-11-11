import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { GitIsolationPort } from '../../application/ports/agent-execution-port.js';

const execFileAsync=promisify(execFile);
const uuid=/^[a-f0-9-]{36}$/i;

/** Creates one dedicated Git branch/worktree per execution. */
export class GitIsolationService implements GitIsolationPort {
 /** `startPoint` is the integration branch (or, for a revision, the commit of the run being adjusted); default HEAD. */
 async prepare(input:{projectId:string;executionId:string;workItemKey:string;repositoryRoot:string;workspaceRoot:string;requireWorktree:boolean;startPoint?:string}) {
  if(!uuid.test(input.projectId)||!uuid.test(input.executionId))throw new Error('Invalid project or execution id for worktree isolation.');
  const repositoryRoot=await realpath(input.repositoryRoot);
  const topLevel=await git(repositoryRoot,['rev-parse','--show-toplevel']);
  if(resolve(topLevel.trim())!==repositoryRoot)throw new Error('The configured repository path must be the Git repository root.');
  const startPoint=input.startPoint??'HEAD';
  const baseCommit=(await git(repositoryRoot,['rev-parse','--verify',`${startPoint}^{commit}`])).trim();
  // The branch the run integrates into: the given branch, or the one checked out in the user's repository (null when detached).
  const isBranch=input.startPoint?await git(repositoryRoot,['show-ref','--verify','--quiet',`refs/heads/${input.startPoint}`]).then(()=>true,()=>false):false;
  const baseBranch=isBranch?input.startPoint!:input.startPoint?null:(await git(repositoryRoot,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>'')).trim()||null;
  const safeKey=input.workItemKey.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,28)||'task';
  const branchName=`graphdev/${safeKey}-${input.executionId.slice(0,8)}`;
  const workingDirectory=join(input.workspaceRoot,'projects',input.projectId,'worktrees',input.executionId);
  await mkdir(dirname(workingDirectory),{recursive:true});
  try {
   await git(repositoryRoot,['worktree','add','-b',branchName,workingDirectory,baseCommit]);
  } catch(error) {
   throw new Error(`Unable to create isolated Git worktree: ${error instanceof Error?error.message:String(error)}`);
  }
  return {workingDirectory,branchName,baseCommit,baseBranch};
 }

 /** Name of the branch checked out in the user's repository, or null when HEAD is detached. */
 async currentBranch(repositoryRoot:string):Promise<string|null> {
  return (await git(await realpath(repositoryRoot),['symbolic-ref','--quiet','--short','HEAD']).catch(()=>'')).trim()||null;
 }

 async branchExists(repositoryRoot:string,branchName:string):Promise<boolean> {
  return git(await realpath(repositoryRoot),['show-ref','--verify','--quiet',`refs/heads/${branchName}`]).then(()=>true,()=>false);
 }

 /**
  * Creates the integration branch for a feature from `sourceRef` without touching the user's checkout.
  * If `preferredName` is taken by a branch Graph Workspace does not own, a numeric suffix is added.
  */
 async createIntegrationBranch(input:{repositoryRoot:string;preferredName:string;sourceRef:string}):Promise<string> {
  const repositoryRoot=await realpath(input.repositoryRoot);
  const sourceCommit=(await git(repositoryRoot,['rev-parse','--verify',`${input.sourceRef}^{commit}`])).trim();
  for(let attempt=1;attempt<100;attempt+=1){
   const name=attempt===1?input.preferredName:`${input.preferredName}-${attempt}`;
   await git(repositoryRoot,['check-ref-format','--branch',name]);
   const exists=await git(repositoryRoot,['show-ref','--verify','--quiet',`refs/heads/${name}`]).then(()=>true,()=>false);
   if(exists)continue;
   await git(repositoryRoot,['branch',name,sourceCommit]);
   return name;
  }
  throw new Error(`No hay un nombre de rama libre para ${input.preferredName}.`);
 }

 /**
  * Squash-merges `sourceRef` into `targetBranch` inside a throwaway worktree, so the user's checkout is never touched.
  * Refuses when the target branch is checked out somewhere (updating it would desynchronize that working tree).
  */
 async squashMerge(input:{repositoryRoot:string;workspaceRoot:string;projectId:string;targetBranch:string;sourceRef:string;message:string}):Promise<SquashMergeResult> {
  if(!uuid.test(input.projectId))throw new Error('Invalid project id for merge.');
  const repositoryRoot=await realpath(input.repositoryRoot);
  const checkedOut=checkedOutPath(await git(repositoryRoot,['worktree','list','--porcelain']),input.targetBranch);
  if(checkedOut)return {ok:false,reason:'CHECKED_OUT',detail:`La rama ${input.targetBranch} está abierta en ${checkedOut}. Cambia de rama allí para poder integrar.`,conflicts:[]};
  const directory=join(input.workspaceRoot,'projects',input.projectId,'merges',randomUUID());
  await mkdir(dirname(directory),{recursive:true});
  await git(repositoryRoot,['worktree','add','--quiet',directory,input.targetBranch]);
  const run=(args:string[])=>git(directory,['-c','core.fsmonitor=false','-c',`core.hooksPath=${join(directory,'.graphdev-no-hooks')}`,...args]);
  try{
   try{await run(['merge','--squash','--no-commit',input.sourceRef]);}
   catch(error){
    const conflicts=(await run(['diff','--name-only','--diff-filter=U']).catch(()=>'')).split('\n').filter(Boolean);
    return {ok:false,reason:'CONFLICT',detail:conflicts.length?`Conflicto al integrar en ${input.targetBranch}.`:`No se pudo integrar en ${input.targetBranch}: ${error instanceof Error?error.message:String(error)}`,conflicts};
   }
   const staged=await run(['diff','--cached','--quiet']).then(()=>false,()=>true);
   if(staged){
    const hasIdentity=await run(['config','user.email']).then(value=>Boolean(value.trim()),()=>false);
    await run([...(hasIdentity?[]:['-c','user.name=Graph Workspace','-c','user.email=graph-workspace@localhost']),'commit','--no-verify','--quiet','-m',input.message]);
   }
   return {ok:true,commit:(await run(['rev-parse','HEAD'])).trim(),changed:staged};
  }finally{
   await git(repositoryRoot,['worktree','remove','--force',directory]).catch(()=>undefined);
   await rm(directory,{recursive:true,force:true});
   await git(repositoryRoot,['worktree','prune']).catch(()=>undefined);
  }
 }

 async discard(input:{repositoryRoot:string;workspaceRoot:string;workingDirectory:string;branchName:string}):Promise<void> {
  // Only ever touch what `prepare` creates: a graphdev/ branch and a worktree under the workspace worktrees folder.
  const worktreesRoot=resolve(input.workspaceRoot,'projects');
  const target=resolve(input.workingDirectory);
  const rel=relative(worktreesRoot,target).split(sep);
  if(!input.branchName.startsWith('graphdev/')||rel.length!==3||rel[0]===''||rel[0]==='..'||rel[1]!=='worktrees'||!uuid.test(rel[0]!)||!uuid.test(rel[2]!))throw new Error('Refusing to discard a worktree that Graph Workspace did not create.');
  const repositoryRoot=await realpath(input.repositoryRoot);
  await git(repositoryRoot,['worktree','remove','--force',target]).catch(()=>undefined);
  await rm(target,{recursive:true,force:true});
  await git(repositoryRoot,['worktree','prune']);
  await git(repositoryRoot,['branch','-D',input.branchName]).catch(()=>undefined);
 }
}

export async function git(cwd:string,args:string[],maxBuffer=32*1024*1024):Promise<string> {
 const {stdout}=await execFileAsync('git',args,{cwd,encoding:'utf8',maxBuffer,windowsHide:true});
 return stdout;
}

export type SquashMergeResult={ok:true;commit:string;changed:boolean}|{ok:false;reason:'CONFLICT'|'CHECKED_OUT';detail:string;conflicts:string[]};

function checkedOutPath(porcelain:string,branch:string):string|null {
 let path:string|null=null;
 for(const line of porcelain.split('\n')){
  if(line.startsWith('worktree '))path=line.slice('worktree '.length);
  else if(line===`branch refs/heads/${branch}`)return path;
 }
 return null;
}
