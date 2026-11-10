import { useState } from 'react';
import { GraphCanvas } from '../presentation/graph/GraphCanvas.js';
import { ContextualInspector } from '../presentation/inspector/ContextualInspector.js';
import { DocumentsPanel } from '../presentation/documents/DocumentsPanel.js';
import { useWorkspaceNavigation } from './workspace-navigation-context.js';
import { ProjectCreateForm } from './project-create-form.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../shared/contracts/graph-view.js';
import { PlanningWorkspace } from '../presentation/planning/PlanningWorkspace.js';
import { AgentsWorkspace } from '../presentation/agents/AgentsWorkspace.js';

export function WorkspaceShell() {
 const state=useWorkspaceNavigation();
 const {projects,activeProject,workspace,inspector,selectedEntityId,loading,error}=state;
 const [activeView,setActiveView]=useState<'graph'|'documents'|'planning'|'agents'>('graph');
 if(loading&&!workspace) return <div className="grid min-h-screen place-items-center bg-[#090d18] text-sm text-slate-400">Preparando workspace…</div>;
 return <main className="flex min-h-screen flex-col bg-[#090d18] text-slate-100">
  <header className="flex min-h-[72px] shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 px-7 py-3">
   <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400/10 text-sm font-bold text-cyan-300">G</div><div><p className="text-sm font-semibold tracking-tight">Graph Workspace</p><p className="text-[10px] uppercase tracking-[0.17em] text-slate-600">Local engineering memory</p></div></div>
   {activeProject&&<div className="flex flex-wrap items-center gap-4">
    <span className="text-xs text-slate-300">{activeProject.name}</span>
    <span className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-500">REV {activeProject.currentRevision}</span>
    <select aria-label="Proyecto activo" value={activeProject.id} onChange={event=>void state.openProject(event.target.value)} className="max-w-48 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"><option value={activeProject.id}>{activeProject.name}</option>{projects.filter(project=>project.id!==activeProject.id).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select>
    <button type="button" onClick={()=>void state.refreshProjects()} className="rounded px-2 py-1 text-xs text-slate-500 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-cyan-400">Actualizar proyectos</button>
    <nav aria-label="Vistas del proyecto" className="flex rounded-lg border border-slate-800 bg-slate-950 p-1"><button type="button" aria-pressed={activeView==='graph'} onClick={()=>setActiveView('graph')} className={`rounded-md px-3 py-1.5 text-xs ${activeView==='graph'?'bg-slate-800 text-white':'text-slate-500 hover:text-slate-200'}`}>Grafo</button><button type="button" aria-pressed={activeView==='documents'} onClick={()=>setActiveView('documents')} className={`rounded-md px-3 py-1.5 text-xs ${activeView==='documents'?'bg-slate-800 text-white':'text-slate-500 hover:text-slate-200'}`}>Documentos</button><button type="button" aria-pressed={activeView==='planning'} onClick={()=>setActiveView('planning')} className={`rounded-md px-3 py-1.5 text-xs ${activeView==='planning'?'bg-slate-800 text-white':'text-slate-500 hover:text-slate-200'}`}>Planificar</button><button type="button" aria-pressed={activeView==='agents'} onClick={()=>setActiveView('agents')} className={`rounded-md px-3 py-1.5 text-xs ${activeView==='agents'?'bg-slate-800 text-white':'text-slate-500 hover:text-slate-200'}`}>Agentes</button></nav>
   </div>}
  </header>
  {error&&<div role="alert" className="mx-7 mt-4 rounded-lg border border-rose-900/70 bg-rose-950/50 px-4 py-3 text-xs text-rose-300">{error}</div>}
  {workspace?<div className="flex min-h-0 flex-1 p-5 lg:p-7">{activeView==='agents'?<AgentsWorkspace projectId={workspace.project.id} nodes={workspace.graph.nodes} selectedEntityId={selectedEntityId}/>:activeView==='planning'?<PlanningWorkspace/>:activeView==='documents'
   ?<DocumentsPanel projectId={workspace.project.id} nodes={workspace.graph.nodes}/>
   :<div className="flex min-h-0 min-w-0 flex-1 gap-4"><GraphCanvas nodes={workspace.graph.nodes} edges={workspace.graph.edges} selectedId={selectedEntityId} onSelect={id=>void state.selectEntity(id)} onFilter={(nodeTypes:KnowledgeEntityType[],edgeTypes:GraphEdgeType[])=>void state.refreshGraph({entityTypes:nodeTypes,edgeTypes})}/><ContextualInspector details={inspector} contextPackage={state.contextPackage} contextLoading={state.contextLoading} contextError={state.contextError} onRefreshContext={state.refreshContext}/></div>}
  </div>:<div className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-8 px-6 py-12 md:grid-cols-[0.9fr_1.1fr]"><div className="self-center"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">Structured project knowledge</p><h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight tracking-tight text-white">El contexto del proyecto, conectado.</h1><p className="mt-4 max-w-lg text-sm leading-6 text-slate-400">Explora estructura, requerimientos, decisiones y trabajo desde un único grafo local.</p>{projects.length>0&&<div className="mt-8"><p className="mb-3 text-xs font-medium text-slate-400">Workspaces recientes</p><ul className="space-y-2">{projects.map(project=><li key={project.id}><button type="button" onClick={()=>void state.openProject(project.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-cyan-400"><span><span className="block text-sm font-medium text-slate-200">{project.name}</span><span className="mt-1 block font-mono text-[10px] text-slate-600">{project.slug}</span></span><span className="text-xs text-slate-600">REV {project.currentRevision} →</span></button></li>)}</ul></div>}</div><div className="self-center"><ProjectCreateForm onCreate={state.createProject} disabled={loading}/></div></div>}
  <footer className="flex h-9 shrink-0 items-center justify-between border-t border-slate-900 px-7 text-[10px] text-slate-600"><span>Local-first · Tauri · SQLite</span><span>{activeProject?`${workspace?.graph.nodes.length??0} entidades · ${workspace?.graph.edges.length??0} relaciones`:'Sin proyecto abierto'}</span></footer>
 </main>;
}
