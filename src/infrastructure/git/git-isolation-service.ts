import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { GitIsolationPort } from '../../application/ports/agent-execution-port.js';

const execFileAsync=promisify(execFile);
const uuid=/^[a-f0-9-]{36}$/i;

/** Creates one dedicated Git branch/worktree per execution. */
export class GitIsolationService implements GitIsolationPort {
 async prepare(input:{projectId:string;executionId:string;workItemKey:string;repositoryRoot:string;workspaceRoot:string;requireWorktree:boolean}) {
  if(!uuid.test(input.projectId)||!uuid.test(input.executionId))throw new Error('Invalid project or execution id for worktree isolation.');
  const repositoryRoot=await realpath(input.repositoryRoot);
  const topLevel=await git(repositoryRoot,['rev-parse','--show-toplevel']);
  if(resolve(topLevel.trim())!==repositoryRoot)throw new Error('The configured repository path must be the Git repository root.');
  const baseCommit=(await git(repositoryRoot,['rev-parse','HEAD'])).trim();
  const safeKey=input.workItemKey.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,28)||'task';
  const branchName=`graphdev/${safeKey}-${input.executionId.slice(0,8)}`;
  const workingDirectory=join(input.workspaceRoot,'projects',input.projectId,'worktrees',input.executionId);
  await mkdir(dirname(workingDirectory),{recursive:true});
  try {
   await git(repositoryRoot,['worktree','add','-b',branchName,workingDirectory,baseCommit]);
  } catch(error) {
   throw new Error(`Unable to create isolated Git worktree: ${error instanceof Error?error.message:String(error)}`);
  }
  return {workingDirectory,branchName,baseCommit};
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
