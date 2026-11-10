import { createInterface } from 'node:readline';
import { createWorkspaceCore, type WorkspaceRequest } from './workspace-core.js';

interface SidecarRequest { id:string; request:WorkspaceRequest }
const output=(value:unknown)=>process.stdout.write(`${JSON.stringify(value)}\n`);
const root=process.env.GRAPHDEV_WORKSPACE_ROOT;
if(!root) throw new Error('GRAPHDEV_WORKSPACE_ROOT is required.');
const core=createWorkspaceCore(root,(channel,payload)=>output({type:'event',channel,payload}));
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});

try {
  for await (const line of lines) {
    if(!line.trim()) continue;
    let input:SidecarRequest;
    try { input=JSON.parse(line) as SidecarRequest; }
    catch(error) { output({id:null,ok:false,error:`Invalid sidecar request: ${error instanceof Error?error.message:String(error)}`});continue; }
    try {
      const result=await core.handle(input.request);
      output({id:input.id,ok:true,result});
    } catch(error) {
      output({id:input.id,ok:false,error:error instanceof Error?error.message:String(error)});
    }
  }
} finally { core.close(); }
