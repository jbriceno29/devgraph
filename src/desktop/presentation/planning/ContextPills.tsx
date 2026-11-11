import { useState } from 'react';
import { useResetOnChange } from '../use-reset-on-change.js';
import type { ContextPackageDto } from '../../../shared/contracts/context-view.js';
import { AUTHORITY_TIER, authorityLabel, exclusionLabel, retrievalLabel, sourceTypeLabel } from '../labels.js';
import { ErrorNotice } from '../errors.js';

const summary='min-h-9 cursor-pointer rounded py-2.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
/** El contexto que recibiría un agente para la feature o tarea elegida: qué fuentes entran, cuáles no y por qué. */
export function ContextPills({context,loading,error,onRefresh}:{context:ContextPackageDto|null;loading:boolean;error:string|null;onRefresh(maxTokens:number,query?:string):void}){
 const [budget,setBudget]=useState(()=>context?String(context.snapshot.tokenUsage.maxAllowedTokens):'32000');useResetOnChange(context?.snapshot.id,()=>{if(context)setBudget(String(context.snapshot.tokenUsage.maxAllowedTokens));});
 const tiers=context?[...new Set(context.snapshot.includedSources.map(source=>source.authorityTier))].sort():[];
 return <section className="rounded-lg border border-border bg-surface-sunken p-3" aria-label="Paquete de contexto">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Contexto para el agente</h3>{context&&<span className="text-[11px] text-accent">{context.snapshot.includedSources.length} incluidas · {context.snapshot.excludedSources.length} excluidas</span>}</div>
  {loading&&!context?<p role="status" className="mt-2 text-xs text-fg-muted">Preparando fuentes del proyecto…</p>:null}
  {error&&<ErrorNotice error={error} className="mt-2"/>}
  {!context&&!loading&&!error&&<p className="mt-2 text-xs text-fg-muted">Selecciona una feature o tarea para preparar el contexto.</p>}
  {context&&<>
   {context.warnings?.map(warning=><p key={warning} role="alert" className="mt-2 text-xs text-warning">{warning}</p>)}
   <p className="mt-2 text-[11px] text-fg-muted">{context.snapshot.tokenUsage.totalUsedTokens.toLocaleString('es')} de {context.snapshot.tokenUsage.maxAllowedTokens.toLocaleString('es')} tokens estimados · versión {context.snapshot.graphRevision} del grafo</p>
   <details className="mt-2"><summary className={`${summary} text-accent`}>Ver fuentes incluidas ({context.snapshot.includedSources.length})</summary>
    <p className="mt-2 text-[11px] text-fg-subtle">Nivel de autoridad: cuanto menor, más peso tiene la fuente ({tiers.map(tier=>`${tier} = ${AUTHORITY_TIER[tier]??'otro'}`).join(', ')}).</p>
    <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">{context.snapshot.includedSources.map(source=><li key={source.sourceId} className="rounded border border-border bg-surface-raised px-2 py-1.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-fg" title={source.titleOrPath}>{source.titleOrPath}</span><span title={authorityLabel(source.authorityTier)} className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent"><span className="sr-only">Nivel de autoridad </span><span aria-hidden="true">Nivel </span>{source.authorityTier}</span></div><p className="mt-0.5 text-[11px] text-fg-subtle">{sourceTypeLabel(source.sourceType)} · {source.tokenCount} tokens · vía {retrievalLabel(source.retrievalOrigin)}</p></li>)}</ul></details>
   {context.snapshot.excludedSources.length>0&&<details className="mt-1.5"><summary className={`${summary} text-warning`}>Fuentes excluidas ({context.snapshot.excludedSources.length})</summary><ul className="mt-2 space-y-1">{context.snapshot.excludedSources.map(source=><li key={source.sourceId} className="text-[11px] leading-4 text-fg-muted">{source.titleOrPath} · nivel {source.authorityTier} · {exclusionLabel(source.exclusionReason)}</li>)}</ul></details>}
   <details className="mt-2"><summary className={`${summary} text-fg-muted`}>Presupuesto y texto del contexto</summary><div className="mt-2 flex items-end gap-2"><label className="min-w-0 flex-1 text-[11px] text-fg-muted">Presupuesto máximo de tokens<input aria-label="Presupuesto máximo de tokens" type="number" min="1" max="1000000" step="1000" value={budget} onChange={event=>setBudget(event.target.value)} className="mt-1 min-h-9 w-full rounded border border-border-strong bg-surface-raised px-2 text-xs text-fg"/></label><button type="button" disabled={loading||!Number.isInteger(Number(budget))||Number(budget)<1} onClick={()=>onRefresh(Number(budget))} className="min-h-9 rounded border border-border-strong px-3 text-xs text-fg hover:border-accent disabled:opacity-40">Recalcular</button></div><p className="mt-2 text-[11px] text-fg-subtle">Este es el texto exacto que recibe el agente; no cambia durante la ejecución.</p><pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-surface-raised p-2 text-[11px] leading-4 text-fg-muted">{context.packageText}</pre></details>
  </>}
 </section>;
}
