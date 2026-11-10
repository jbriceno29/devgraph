import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ArtifactDocumentDto, CreateArtifactDocumentInput } from '../../../shared/contracts/artifact-view.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';

const artifactTypes=['PRD','ARCHITECTURE','SPEC','IMPLEMENTATION_PLAN','DOMAIN_DOC','OTHER'] as const;
const eligibleTarget=(node:GraphNodeView)=>['PROJECT_ROOT','MODULE','FEATURE','REQUIREMENT','WORK_ITEM'].includes(node.type);

export function DocumentsPanel({projectId,nodes}:{projectId:string;nodes:GraphNodeView[]}) {
 const [documents,setDocuments]=useState<ArtifactDocumentDto[]>([]),[repositoryPath,setRepositoryPath]=useState<string|null>(null),[pathInput,setPathInput]=useState(''),[selectedId,setSelectedId]=useState<string|null>(null),[content,setContent]=useState(''),[baseHash,setBaseHash]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState(''),[documentKind,setDocumentKind]=useState<'ARTIFACT'|'DECISION_RECORD'>('ARTIFACT'),[artifactType,setArtifactType]=useState<(typeof artifactTypes)[number]>('SPEC'),[title,setTitle]=useState(''),[targetEntityId,setTargetEntityId]=useState('');
 const targets=useMemo(()=>nodes.filter(eligibleTarget),[nodes]);
 const selectedTargetId=targets.some(node=>node.id===targetEntityId)?targetEntityId:targets[0]?.id??'';
 const selected=documents.find(document=>document.id===selectedId)??null;

 const refreshList=useCallback(async()=>{
  const [path,items]=await Promise.all([window.workspaceIpc.queries.getRepositoryPath(projectId),window.workspaceIpc.queries.listArtifacts(projectId)]);
  setRepositoryPath(path);setDocuments(items);setPathInput(current=>current||path||'');
  setSelectedId(current=>current&&items.some(item=>item.id===current)?current:items[0]?.id??null);
 },[projectId]);
 const loadDocument=useCallback(async(id:string)=>{
  setError(null);
  try {const view=await window.workspaceIpc.queries.getArtifact(id);setContent(view.content);setBaseHash(view.document.contentHash);setDirty(false);setDocuments(items=>items.map(item=>item.id===id?view.document:item));}
  catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
 },[]);

 useEffect(()=>{void refreshList().catch(cause=>setError(String(cause)));},[refreshList]);
 useEffect(()=>{if(selectedId&&!dirty)void loadDocument(selectedId);else if(!selectedId){setContent('');setBaseHash('');}},[selectedId,dirty,loadDocument]);
 useEffect(()=>window.workspaceIpc.events.onArtifactSyncStatusChanged(event=>{
  if(event.projectId!==projectId)return;
  setDocuments(items=>items.map(item=>item.id===event.documentId?{...item,syncStatus:event.syncStatus}:item));
  setNotice(`${event.relativePath}: ${statusLabel(event.syncStatus)}.`);
  if(event.documentId===selectedId&&!dirty)void loadDocument(event.documentId);
 }),[projectId,selectedId,dirty,loadDocument]);

 const configureRepository=async(event:FormEvent)=>{
  event.preventDefault();setBusy(true);setError(null);setNotice('');
  try {const result=await window.workspaceIpc.commands.configureRepository(projectId,pathInput.trim());setRepositoryPath(result.localPath);setPathInput(result.localPath);setNotice('Repositorio conectado.');await refreshList();}
  catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  finally{setBusy(false);}
 };
 const createDocument=async(event:FormEvent)=>{
  event.preventDefault();if(!title.trim()||!targetEntityId)return;
  setBusy(true);setError(null);setNotice('');
  const input:CreateArtifactDocumentInput={projectId,entityType:documentKind,title:title.trim(),targetEntityId:selectedTargetId,...(documentKind==='ARTIFACT'?{artifactType}:{})};
  try {const created=await window.workspaceIpc.commands.createArtifact(input);await refreshList();setSelectedId(created.document.id);setContent(created.content);setBaseHash(created.document.contentHash);setDirty(false);setTitle('');setNotice(`${created.document.relativePath} creado y vinculado al grafo.`);}
  catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  finally{setBusy(false);}
 };
 const saveDocument=async(event:FormEvent)=>{
  event.preventDefault();if(!selected||!dirty)return;
  setBusy(true);setError(null);setNotice('');
  try {const saved=await window.workspaceIpc.commands.saveArtifact(selected.id,baseHash,content);setDocuments(items=>items.map(item=>item.id===selected.id?saved.document:item));setBaseHash(saved.document.contentHash);setDirty(false);setNotice('Documento guardado y sincronizado.');}
  catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  finally{setBusy(false);}
 };

 return <section aria-labelledby="documents-heading" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1120]">
  <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
   <div><h1 id="documents-heading" className="text-base font-semibold text-white">Documentos Markdown</h1><p className="mt-1 text-xs text-slate-500">Archivos del repositorio vinculados al grafo del proyecto.</p></div>
   {repositoryPath&&<p className="max-w-[45%] truncate font-mono text-[10px] text-slate-500" title={repositoryPath}>{repositoryPath}</p>}
  </header>
  {!repositoryPath?<form onSubmit={configureRepository} className="m-5 max-w-2xl space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
   <div><h2 className="text-sm font-medium text-slate-200">Conecta el repositorio Git</h2><p className="mt-1 text-xs leading-5 text-slate-500">Escribe la ruta absoluta de la carpeta que contiene <code>.git</code>. Graph Workspace observará su carpeta <code>docs/</code>.</p></div>
   <div><label htmlFor="repository-path" className="mb-1.5 block text-xs text-slate-400">Ruta local del repositorio</label><input id="repository-path" name="repositoryPath" required value={pathInput} onChange={event=>setPathInput(event.target.value)} autoCapitalize="none" spellCheck={false} placeholder="/home/usuario/proyectos/mi-repo" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus-visible:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/30" /></div>
   <button type="submit" disabled={busy} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50">Conectar repositorio</button>
  </form>:<div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
   <aside aria-label="Lista de documentos" className="flex min-h-0 flex-col border-b border-slate-800 lg:border-b-0 lg:border-r">
    <div className="flex items-center justify-between px-4 py-3"><h2 className="text-xs font-semibold text-slate-300">Documentos ({documents.length})</h2><button type="button" onClick={()=>void refreshList().catch(cause=>setError(String(cause)))} className="rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-cyan-400">Actualizar</button></div>
    <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
     {documents.map(document=><li key={document.id}><button type="button" onClick={()=>{if(dirty&&!window.confirm('Descartar los cambios locales sin guardar?'))return;setDirty(false);setSelectedId(document.id);}} aria-pressed={document.id===selectedId} className={`w-full rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-cyan-400 ${document.id===selectedId?'border-cyan-500/40 bg-cyan-500/10':'border-transparent hover:border-slate-800 hover:bg-slate-900'}`}><span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium text-slate-200">{document.title}</span><span className={`shrink-0 text-[9px] ${statusClass(document.syncStatus)}`}>{statusLabel(document.syncStatus)}</span></span><span className="mt-1 block truncate font-mono text-[9px] text-slate-600">{document.relativePath}</span></button></li>)}
     {!documents.length&&<li className="px-3 py-8 text-center text-xs leading-5 text-slate-600">Aún no hay artefactos ni ADRs.</li>}
    </ul>
    <details className="border-t border-slate-800 p-3">
     <summary className="cursor-pointer rounded px-2 py-2 text-xs font-medium text-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-400">Crear documento</summary>
     <form onSubmit={createDocument} className="mt-3 space-y-3">
      <div><label htmlFor="document-kind" className="mb-1 block text-[10px] text-slate-500">Tipo de registro</label><select id="document-kind" name="documentKind" value={documentKind} onChange={event=>setDocumentKind(event.target.value as typeof documentKind)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-cyan-400"><option value="ARTIFACT">Artefacto</option><option value="DECISION_RECORD">ADR / Decisión</option></select></div>
      {documentKind==='ARTIFACT'&&<div><label htmlFor="artifact-type" className="mb-1 block text-[10px] text-slate-500">Plantilla</label><select id="artifact-type" name="artifactType" value={artifactType} onChange={event=>setArtifactType(event.target.value as typeof artifactType)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-cyan-400">{artifactTypes.map(type=><option key={type} value={type}>{artifactTypeLabel(type)}</option>)}</select></div>}
      <div><label htmlFor="document-title" className="mb-1 block text-[10px] text-slate-500">Título</label><input id="document-title" name="title" required value={title} onChange={event=>setTitle(event.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-cyan-400" /></div>
      <div><label htmlFor="document-target" className="mb-1 block text-[10px] text-slate-500">Vincular con</label><select id="document-target" name="targetEntityId" required value={selectedTargetId} onChange={event=>setTargetEntityId(event.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-cyan-400">{targets.map(node=><option key={node.id} value={node.id}>{node.key} · {node.label}</option>)}</select></div>
      <button type="submit" disabled={busy||!targets.length} className="w-full rounded-md bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50">Crear y vincular</button>
     </form>
    </details>
   </aside>
   {selected?<form onSubmit={saveDocument} className="flex min-h-0 min-w-0 flex-col">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3"><div className="min-w-0"><h2 className="truncate text-sm font-medium text-slate-100">{selected.title}</h2><p className="mt-1 truncate font-mono text-[10px] text-slate-600">{selected.displayKey} · {selected.relativePath}</p></div><div className="flex items-center gap-3"><span className={`text-[10px] ${statusClass(selected.syncStatus)}`}>{statusLabel(selected.syncStatus)}{dirty?' · cambios locales':''}</span><button type="submit" disabled={busy||!dirty} className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">Guardar Markdown</button></div></div>
    <div className="grid min-h-0 flex-1 xl:grid-cols-2">
     <div className="flex min-h-0 flex-col border-b border-slate-800 xl:border-b-0 xl:border-r"><label htmlFor="markdown-content" className="border-b border-slate-800 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Editor Markdown — contenido</label><textarea id="markdown-content" name="content" value={content} onChange={event=>{setContent(event.target.value);setDirty(true);}} spellCheck autoCapitalize="sentences" className="min-h-[280px] flex-1 resize-y bg-[#090e1b] p-4 font-mono text-xs leading-6 text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500/50" /></div>
     <section aria-labelledby="markdown-preview-heading" className="min-h-[280px] overflow-auto bg-[#0b1120] px-5 py-4"><h3 id="markdown-preview-heading" className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Vista previa</h3><article className="markdown-preview"><ReactMarkdown>{content}</ReactMarkdown></article></section>
    </div>
   </form>:<div className="grid min-h-64 place-items-center p-8 text-center text-xs text-slate-600">Selecciona un documento o crea uno desde una plantilla.</div>}
  </div>}
  {(error||notice)&&<p role={error?'alert':'status'} aria-live={error?'assertive':'polite'} className={`border-t px-4 py-2.5 text-xs ${error?'border-rose-900/50 text-rose-300':'border-slate-800 text-slate-400'}`}>{error??notice}</p>}
 </section>;
}

function artifactTypeLabel(type:(typeof artifactTypes)[number]):string {return ({PRD:'PRD',ARCHITECTURE:'Arquitectura',SPEC:'Especificación',IMPLEMENTATION_PLAN:'Plan de implementación',DOMAIN_DOC:'Documento de dominio',OTHER:'Otro'})[type];}
function statusLabel(status:ArtifactDocumentDto['syncStatus']):string {return ({SYNCED:'Sincronizado',DRIFTED:'Cambio externo',MISSING:'Archivo ausente',UNTRACKED:'Sin seguimiento'})[status];}
function statusClass(status:ArtifactDocumentDto['syncStatus']):string {return ({SYNCED:'text-emerald-400',DRIFTED:'text-amber-300',MISSING:'text-rose-400',UNTRACKED:'text-slate-500'})[status];}
