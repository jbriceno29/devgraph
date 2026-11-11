import { useEffect, useId, useState } from 'react';
import type { FeatureIntegrationResultDto, FeatureIntegrationStateDto } from '../../../shared/contracts/agent-view.js';
import { ErrorNotice } from '../errors.js';
import { primary, secondary } from '../ui.js';

/** Se puede integrar: tiene rama de integración y todas sus tareas están hechas o archivadas. */
export const canIntegrate=(state:FeatureIntegrationStateDto|null|undefined):state is FeatureIntegrationStateDto=>Boolean(state&&state.taskCount>0&&state.openTaskCount===0);
const into=(branch:string|null)=>branch?`en ${branch}`:'en la rama principal';
export const integrateLabel=(branch:string|null)=>`Integrar ${into(branch)}`;

/**
 * «Integrar en main» de una feature terminada: explica qué hace, pide confirmación y muestra el resultado.
 * Sin `onIntegrate` (núcleo antiguo) o con tareas pendientes no se muestra nada.
 */
export function FeatureIntegration({featureKey,state,onIntegrate,onDone,className=''}:{featureKey:string;state:FeatureIntegrationStateDto|null|undefined;onIntegrate?:(()=>Promise<FeatureIntegrationResultDto>)|undefined;onDone?(result:FeatureIntegrationResultDto):void;className?:string}) {
 const id=useId();
 const [confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false);
 const [result,setResult]=useState<FeatureIntegrationResultDto|null>(null),[error,setError]=useState<unknown>(null);
 useEffect(()=>{setConfirming(false);setResult(null);setError(null);},[featureKey]);
 if(!onIntegrate||!canIntegrate(state))return null;
 const target=result?.targetBranch??state.targetBranch;
 const run=async()=>{setBusy(true);setError(null);try{const next=await onIntegrate();setResult(next);setConfirming(false);onDone?.(next);}catch(reason){setError(reason);}finally{setBusy(false);}};
 return <div role="group" aria-labelledby={`${id}-title`} className={`space-y-2 rounded-lg border border-success/40 bg-success-soft p-3 text-xs text-fg ${className}`}>
  <p id={`${id}-title`} className="font-semibold text-success">{featureKey} está terminada</p>
  <p id={`${id}-help`} className="text-fg-muted">Junta el trabajo de la feature {into(target)}. No envía nada a ningún remoto y no toca tu carpeta si tiene cambios sin guardar.</p>
  {state.integratedAt&&!result&&<p className="text-fg-muted">Ya la integraste el {new Date(state.integratedAt).toLocaleDateString('es')}; puedes repetirlo sin riesgo.</p>}
  {!confirming&&<button type="button" onClick={()=>{setConfirming(true);setError(null);setResult(null);}} disabled={busy} aria-describedby={`${id}-help`} className={`min-h-9 w-full text-xs ${result?secondary:primary}`}>{integrateLabel(target)}</button>}
  {confirming&&<div className="space-y-2">
   <p className="font-medium">¿Integrar {featureKey} {into(target)}?</p>
   <div className="flex gap-2"><button type="button" onClick={()=>void run()} disabled={busy} className={`min-h-9 flex-1 text-xs ${primary}`}>{busy?'Integrando…':'Sí, integrar'}</button><button type="button" onClick={()=>setConfirming(false)} disabled={busy} className={`min-h-9 flex-1 text-xs ${secondary}`}>Cancelar</button></div>
  </div>}
  {result&&<p role="status" className="font-medium text-success">{result.alreadyIntegrated?`Ya estaba integrada ${into(result.targetBranch)}.`:`Integrada ${into(result.targetBranch)}${result.commit?` · commit ${result.commit.slice(0,7)}`:''}.`}</p>}
  <ErrorNotice error={error}/>
 </div>;
}
