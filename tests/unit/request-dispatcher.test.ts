import { describe, expect, it } from 'vitest';
import { createRequestDispatcher } from '../../src/infrastructure/ipc/sidecar/request-dispatcher.js';
import type { WorkspaceRequest } from '../../src/infrastructure/ipc/sidecar/workspace-core.js';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
const line=(id:string,channel:string)=>JSON.stringify({id,request:{channel,args:[]}});

describe('sidecar request dispatcher (D1)',()=>{
 it('answers a query while a slow ChangeSet proposal is still running',async()=>{
  const slow=deferred();const answered:string[]=[];
  const dispatcher=createRequestDispatcher({handle:async(request:WorkspaceRequest)=>{if(request.channel==='changeset:propose_from_chat')await slow.promise;return request.channel;}},value=>answered.push((value as {id:string}).id));
  dispatcher.dispatch(line('propose','changeset:propose_from_chat'));
  dispatcher.dispatch(line('list','project:list'));
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(answered).toEqual(['list']);
  slow.resolve();await dispatcher.drain();
  expect(answered).toEqual(['list','propose']);
 });

 it('runs mutating commands one at a time in arrival order',async()=>{
  const first=deferred();const order:string[]=[];let running=0,maxRunning=0;
  const dispatcher=createRequestDispatcher({handle:async(request:WorkspaceRequest)=>{running+=1;maxRunning=Math.max(maxRunning,running);order.push(`start ${request.channel}`);if(request.channel==='artifact:save')await first.promise;running-=1;order.push(`end ${request.channel}`);return null;}},()=>undefined);
  dispatcher.dispatch(line('a','artifact:save'));dispatcher.dispatch(line('b','changeset:apply'));
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(order).toEqual(['start artifact:save']);
  first.resolve();await dispatcher.drain();
  expect(order).toEqual(['start artifact:save','end artifact:save','start changeset:apply','end changeset:apply']);expect(maxRunning).toBe(1);
 });

 it('keeps the queue going after a failed command and reports errors with the request id',async()=>{
  const outputs:unknown[]=[];
  const dispatcher=createRequestDispatcher({handle:async(request:WorkspaceRequest)=>{if(request.channel==='changeset:apply')throw new Error('REVISION_CONFLICT');return 'ok';}},value=>outputs.push(value));
  dispatcher.dispatch(line('a','changeset:apply'));dispatcher.dispatch(line('b','changeset:reject'));dispatcher.dispatch('not json');
  await dispatcher.drain();
  expect(outputs).toEqual(expect.arrayContaining([{id:'a',ok:false,error:'REVISION_CONFLICT'},{id:'b',ok:true,result:'ok'},expect.objectContaining({id:null,ok:false})]));
 });
});
