import { cpSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
const rustHost=execFileSync('rustc',['--print','host-tuple'],{encoding:'utf8'}).trim();
const rustTarget=process.env.TAURI_ENV_TARGET_TRIPLE??rustHost;
if(rustTarget!==rustHost)throw new Error(`The bundled Node sidecar is for ${rustHost}, but Tauri is building ${rustTarget}. Build Node and better-sqlite3 for the target triple before cross-compiling.`);
const resources=resolve('src-tauri/resources');rmSync(resources,{recursive:true,force:true});mkdirSync(resources,{recursive:true});
cpSync(process.execPath,resolve(resources,'node'));chmodSync(resolve(resources,'node'),0o755);
if(process.platform==='linux')execFileSync('strip',['--strip-all',resolve(resources,'node')]);
if(process.platform==='darwin')execFileSync('strip',['-x',resolve(resources,'node')]);
cpSync(resolve('dist/main'),resolve(resources,'core'),{recursive:true});
for(const packageName of ['better-sqlite3','bindings','file-uri-to-path']) {
 const source=resolve('node_modules',packageName);const destination=resolve(resources,'node_modules',packageName);mkdirSync(dirname(destination),{recursive:true});cpSync(source,destination,{recursive:true});
}
console.log(`Prepared Tauri Node sidecar resources for ${rustHost}.`);
