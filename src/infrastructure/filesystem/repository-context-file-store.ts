import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access,lstat,readFile,realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute,join,relative,sep } from 'node:path';
import type { ContextFilePort } from '../../application/ports/context-engine-port.js';
const execFileAsync=promisify(execFile);
export class RepositoryContextFileStore implements ContextFilePort {
 hashContent(content:string):string{return createHash('sha256').update(content).digest('hex');}
 async getHeadCommit(repositoryRoot:string):Promise<string>{try{await access(join(repositoryRoot,'.git'),constants.F_OK);const {stdout}=await execFileAsync('git',['-C',repositoryRoot,'rev-parse','HEAD'],{timeout:5000});return stdout.trim()||'UNCOMMITTED';}catch{return 'UNCOMMITTED';}}
 async readRepositoryFile(repositoryRoot:string,relativePath:string):Promise<{content:string;contentHash:string}>{if(!relativePath||isAbsolute(relativePath)||/^[A-Za-z]:/.test(relativePath)||relativePath.includes('\\')||relativePath.split('/').some(part=>part==='.'||part==='..'||!part))throw new Error('La ruta de contexto debe ser relativa y segura.');const root=await realpath(repositoryRoot);let parent=root;const parts=relativePath.split('/');for(const part of parts.slice(0,-1)){const next=join(parent,part),info=await lstat(next);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('No se permiten enlaces simbólicos en las rutas de contexto.');parent=await realpath(next);assertInside(root,parent);}const target=join(parent,parts.at(-1)!);const info=await lstat(target);if(info.isSymbolicLink()||!info.isFile())throw new Error('La fuente de contexto no es un archivo regular.');const content=await readFile(target,'utf8');return {content,contentHash:this.hashContent(content)};}
}
function assertInside(root:string,target:string):void{const rel=relative(root,target);if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('La ruta de contexto debe permanecer dentro del repositorio.');}
