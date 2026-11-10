import { randomUUID,createHash } from 'node:crypto';
import { mkdir,open,lstat,readFile,rename,rm,realpath } from 'node:fs/promises';
import { basename,dirname,join,relative,resolve,sep } from 'node:path';
import type { StagedMarkdownFile,TransactionalMarkdownFilePort } from '../../application/ports/change-set-planning-port.js';

export class TransactionalMarkdownFileStore implements TransactionalMarkdownFilePort {
 async applyAtomically(root:string,files:StagedMarkdownFile[],commit:()=>void):Promise<void>{
  if(!files.length){commit();return;}const base=await realpath(root);const staged:Array<{target:string;temp:string;backup:string|null;existed:boolean}>=[];
  try{
   for(const file of files){if(!file.relativePath.startsWith('docs/')||!file.relativePath.toLowerCase().endsWith('.md')||file.relativePath.includes('\\')||file.relativePath.split('/').some(p=>p==='..'||p==='.'||!p))throw new Error('Ruta Markdown insegura.');const parts=file.relativePath.split('/');let parent=base;for(const part of parts.slice(0,-1)){const next=join(parent,part);let info=await lstat(next).catch(async error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(next);return lstat(next);});if(info.isSymbolicLink()||!info.isDirectory())throw new Error('No se permiten enlaces simbólicos ni rutas no directorio en la ruta Markdown.');parent=await realpath(next);assertInside(base,parent);}const target=resolve(parent,parts.at(-1)!);assertInside(base,target);const existing=await lstat(target).catch(error=>(error as NodeJS.ErrnoException).code==='ENOENT'?null:Promise.reject(error));if(existing&&!file.replaceExisting)throw new Error(`Ya existe un documento en ${file.relativePath}.`);if(existing?.isSymbolicLink())throw new Error('No se puede reemplazar un enlace simbólico.');const temp=join(dirname(target),`.${basename(target)}.${randomUUID()}.tmp`);const handle=await open(temp,'wx',existing?existing.mode&0o777:0o666);try{await handle.writeFile(file.content,'utf8');await handle.sync();}finally{await handle.close();}staged.push({target,temp,backup:existing?join(dirname(target),`.${basename(target)}.${randomUUID()}.bak`):null,existed:!!existing});}
   for(const item of staged){if(item.existed)await rename(item.target,item.backup!);await rename(item.temp,item.target);}
   try{commit();}catch(error){for(const item of [...staged].reverse()){await rm(item.target,{force:true}).catch(()=>undefined);if(item.backup)await rename(item.backup,item.target).catch(()=>undefined);}throw error;}
   for(const item of staged)if(item.backup)await rm(item.backup,{force:true});
  }catch(error){for(const item of [...staged].reverse()){await rm(item.temp,{force:true}).catch(()=>undefined);if(item.backup){await rm(item.target,{force:true}).catch(()=>undefined);await rename(item.backup,item.target).catch(()=>undefined);}else if(!item.existed)await rm(item.target,{force:true}).catch(()=>undefined);}throw error;}
 }
 hash(content:string):string{return createHash('sha256').update(content).digest('hex');}
}
function assertInside(root:string,target:string):void{const rel=relative(root,target);if(rel==='..'||rel.startsWith(`..${sep}`))throw new Error('La ruta Markdown debe permanecer dentro del repositorio.');}
