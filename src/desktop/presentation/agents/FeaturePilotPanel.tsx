import { useCallback, useEffect, useState } from 'react';
import type { AutonomyLevelDto, FeaturePilotDto, FeatureReportDto } from '../../../shared/contracts/agent-view.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';

const levels: Array<{ value: AutonomyLevelDto; label: string; help: string }> = [
  { value: 'MANUAL', label: 'Manual', help: 'Tú lanzas cada tarea y decides qué integrar.' },
  { value: 'AUTO_ACCEPT', label: 'Auto-aceptar', help: 'Tú lanzas las tareas; las que pasan auditoría y pruebas se integran solas.' },
  { value: 'PILOT', label: 'Piloto', help: 'Recorre las tareas de la feature, las ejecuta, verifica e integra; te avisa solo cuando hace falta.' },
];
const kindLabel: Record<string, string> = { PLAN_CHANGED: 'Plan modificado', PLAN_PROPOSAL: 'Propuesta de cambios' };
const statusLabel: Record<string, string> = { RUNNING: 'En marcha', PAUSED: 'En pausa', WAITING_USER: 'Esperándote', COMPLETED: 'Feature terminada', STOPPED: 'Detenido', FAILED: 'Error' };

/** Autonomy per feature and the autopilot's controls, status and decision log. */
export function FeaturePilotPanel({ projectId, nodes }: { projectId: string; nodes: GraphNodeView[] }) {
  const features = nodes.filter(node => node.type === 'FEATURE');
  const [featureId, setFeatureId] = useState(features[0]?.id ?? '');
  const [state, setState] = useState<FeaturePilotDto | null>(null);
  const [draft, setDraft] = useState<{ level: AutonomyLevelDto; executionModel: string; escalationModel: string; maxAttempts: string; threshold: string } | null>(null);
  const [confirming, setConfirming] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FeatureReportDto['report'] | null>(null), [exported, setExported] = useState<string | null>(null);

  useEffect(() => { if (!features.some(feature => feature.id === featureId)) setFeatureId(features[0]?.id ?? ''); }, [features, featureId]);

  const load = useCallback(async () => {
    if (!featureId) return;
    try {
      const next = await window.workspaceIpc.queries.getFeaturePilot(projectId, featureId);
      setState(next);
      setDraft(current => current && current.level === next.autonomy.level ? current : { level: next.autonomy.level, executionModel: next.autonomy.executionModel ?? '', escalationModel: next.autonomy.escalationModel ?? '', maxAttempts: String(next.autonomy.maxAttempts), threshold: String(Math.round(next.autonomy.usagePauseThreshold * 100)) });
    } catch (reason) { setError(text(reason)); }
  }, [projectId, featureId]);
  useEffect(() => { setDraft(null); setState(null); void load(); }, [load]);
  useEffect(() => window.workspaceIpc.events.onPilotUpdated(event => { if (event.featureId === featureId) void load(); }), [featureId, load]);

  const act = async (work: () => Promise<unknown>) => { setBusy(true); setError(null); try { await work(); await load(); } catch (reason) { setError(text(reason)); } finally { setBusy(false); } };
  const save = () => draft && act(async () => {
    const saved = await window.workspaceIpc.commands.setFeatureAutonomy(projectId, featureId, { level: draft.level, executionModel: draft.executionModel || null, escalationModel: draft.escalationModel || null, maxAttempts: Number(draft.maxAttempts), usagePauseThreshold: Number(draft.threshold) / 100 });
    setDraft({ level: saved.level, executionModel: saved.executionModel ?? '', escalationModel: saved.escalationModel ?? '', maxAttempts: String(saved.maxAttempts), threshold: String(Math.round(saved.usagePauseThreshold * 100)) });
  });

  if (!features.length) return null;
  const run = state?.run ?? null;
  const active = run && ['RUNNING', 'PAUSED'].includes(run.status);
  const remaining = state?.tasks.filter(task => !['DONE', 'ARCHIVED'].includes(task.status)) ?? [];
  const usage = state?.usage?.utilization != null ? `${Math.round(state.usage.utilization * 100)} % de la ventana ${state.usage.window === 'five_hour' ? 'de 5 h' : state.usage.window}` : 'sin datos todavía';

  return <section aria-label="Autonomía de la feature" className="space-y-3 rounded-xl border border-violet-900/60 bg-violet-950/15 p-4">
    <h2 className="text-xs font-semibold text-violet-200">Autonomía de la feature</h2>
    <div><label htmlFor="pilot-feature" className="mb-1 block text-xs text-slate-400">Feature</label>
      <select id="pilot-feature" value={featureId} onChange={event => setFeatureId(event.target.value)} className="min-h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100">{features.map(feature => <option key={feature.id} value={feature.id}>{feature.key} · {feature.label}</option>)}</select></div>

    {state && draft && <>
      <p className="text-[10px] text-slate-500">{state.tasks.length} tareas · {remaining.length} pendientes{remaining.length ? `: ${remaining.map(task => `${task.displayKey} (${task.status})`).join(', ')}` : ''}</p>
      <fieldset className="space-y-1"><legend className="mb-1 text-xs text-slate-400">Nivel</legend>
        {levels.map(level => <label key={level.value} className="flex items-start gap-2 text-xs text-slate-300"><input type="radio" name="autonomy-level" value={level.value} checked={draft.level === level.value} onChange={() => setDraft({ ...draft, level: level.value })} className="mt-0.5" /><span><span className="font-semibold">{level.label}</span> · <span className="text-slate-500">{level.help}</span></span></label>)}
      </fieldset>
      {draft.level !== 'MANUAL' && <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor="pilot-model" className="mb-1 block text-[10px] text-slate-400">Modelo de ejecución</label>
          <select id="pilot-model" value={draft.executionModel} onChange={event => setDraft({ ...draft, executionModel: event.target.value })} className="min-h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"><option value="">Predeterminado</option>{state.availableModels.map(model => <option key={model} value={model}>{model}</option>)}</select></div>
        <div><label htmlFor="pilot-escalation" className="mb-1 block text-[10px] text-slate-400">Modelo del último intento</label>
          <select id="pilot-escalation" value={draft.escalationModel} onChange={event => setDraft({ ...draft, escalationModel: event.target.value })} className="min-h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"><option value="">El mismo</option>{state.availableModels.map(model => <option key={model} value={model}>{model}</option>)}</select></div>
        <div><label htmlFor="pilot-attempts" className="mb-1 block text-[10px] text-slate-400">Intentos por tarea</label>
          <input id="pilot-attempts" type="number" min={1} max={5} value={draft.maxAttempts} onChange={event => setDraft({ ...draft, maxAttempts: event.target.value })} className="min-h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100" /></div>
        <div><label htmlFor="pilot-threshold" className="mb-1 block text-[10px] text-slate-400">Pausar al llegar al (%)</label>
          <input id="pilot-threshold" type="number" min={50} max={99} value={draft.threshold} onChange={event => setDraft({ ...draft, threshold: event.target.value })} className="min-h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100" /></div>
      </div>}
      <button type="button" onClick={() => void save()} disabled={busy} className="min-h-8 w-full rounded-lg border border-violet-700 px-3 text-xs text-violet-200 hover:bg-violet-950 disabled:opacity-50">Guardar autonomía</button>

      <div><label htmlFor="pilot-auth" className="mb-1 block text-[10px] text-slate-400">Autenticación del motor</label>
        <select id="pilot-auth" value={state.authMode} onChange={event => void act(() => window.workspaceIpc.commands.setAuthMode(projectId, event.target.value as 'subscription' | 'api_key'))} className="min-h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100">
          <option value="subscription">Suscripción (con pausas por límite)</option>
          <option value="api_key" disabled={!state.apiKeyAvailable}>Clave de API{state.apiKeyAvailable ? '' : ' (define ANTHROPIC_API_KEY al abrir la app)'}</option>
        </select></div>

      {state.autonomy.level === 'PILOT' && !active && !confirming && <button type="button" onClick={() => { setConfirming(true); setAcknowledged(false); }} disabled={busy || !remaining.length} className="min-h-10 w-full rounded-lg bg-violet-500 px-4 text-sm font-semibold text-slate-950 hover:bg-violet-400 disabled:opacity-50">{run && ['PAUSED', 'WAITING_USER'].includes(run.status) ? 'Iniciar un piloto nuevo' : 'Iniciar piloto'}</button>}
      {confirming && <div role="group" aria-label="Aviso de costo" className="space-y-2 rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-100">
        <p className="font-semibold">El piloto encadena ejecuciones y consume tu límite de uso.</p>
        <p>Quedan {remaining.length} tareas en esta feature; cada una puede intentarse hasta {state.autonomy.maxAttempts} veces{state.autonomy.executionModel ? ` con ${state.autonomy.executionModel}` : ''}. Uso actual: {usage}. {state.authMode === 'subscription' ? `Con suscripción, el piloto se pausará al llegar al ${Math.round(state.autonomy.usagePauseThreshold * 100)} % y seguirá cuando se renueve la ventana. Para uso intensivo conviene una clave de API del proveedor (se cobra por uso).` : 'Con clave de API, cada ejecución se cobra por uso.'}</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5" /><span>Entiendo el costo y quiero que el piloto trabaje solo en esta feature.</span></label>
        <div className="flex gap-2"><button type="button" onClick={() => void act(async () => { await window.workspaceIpc.commands.startPilot(projectId, featureId, { acknowledgeCost: true }); setConfirming(false); })} disabled={!acknowledged || busy} className="min-h-8 flex-1 rounded bg-violet-500 px-3 font-semibold text-slate-950 disabled:opacity-50">Iniciar</button><button type="button" onClick={() => setConfirming(false)} className="min-h-8 flex-1 rounded border border-slate-600 px-3 text-slate-200">Cancelar</button></div>
      </div>}
      {active && <button type="button" onClick={() => void act(() => window.workspaceIpc.commands.stopPilot(projectId, featureId))} disabled={busy} className="min-h-9 w-full rounded-lg border border-rose-700 px-3 text-xs text-rose-200 hover:bg-rose-950 disabled:opacity-50">Detener piloto</button>}
      {run && ['PAUSED', 'WAITING_USER'].includes(run.status) && <button type="button" onClick={() => void act(() => window.workspaceIpc.commands.resumePilot(projectId, featureId))} disabled={busy} className="min-h-9 w-full rounded-lg border border-violet-700 px-3 text-xs text-violet-200 hover:bg-violet-950 disabled:opacity-50">Reanudar piloto</button>}

      {run && <p role="status" className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-300"><span className="font-semibold">{statusLabel[run.status] ?? run.status}</span>{run.reason ? ` · ${run.reason}` : ''}</p>}
      {state.events.length > 0 && <ol aria-label="Decisiones del piloto" className="max-h-56 space-y-1 overflow-y-auto">{[...state.events].reverse().slice(0, 30).map(event => <li key={event.id} className="text-[10px] text-slate-400"><span className="font-mono text-slate-600">{new Date(event.createdAt).toLocaleTimeString()}</span> <span className="text-violet-300">{kindLabel[event.kind] ?? event.kind.replaceAll('_', ' ')}</span> {event.message}</li>)}</ol>}
    </>}
    {state && <details className="rounded-lg border border-slate-800 bg-slate-950/50" onToggle={event => { if ((event.target as HTMLDetailsElement).open) void act(async () => setReport((await window.workspaceIpc.queries.getFeatureReport(projectId, featureId)).report)); }}>
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-300">Métricas de la feature</summary>
      {report && <div className="space-y-2 border-t border-slate-800 p-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          <dt className="text-slate-500">Tareas cerradas</dt><dd className="text-right text-slate-200">{report.totals.done} de {report.totals.tasks}</dd>
          <dt className="text-slate-500">Ejecuciones</dt><dd className="text-right text-slate-200">{report.totals.executions}</dd>
          <dt className="text-slate-500">Al primer intento</dt><dd className="text-right text-slate-200">{report.totals.acceptedOnFirstAttempt}</dd>
          <dt className="text-slate-500">Sin intervención</dt><dd className="text-right text-slate-200">{report.totals.acceptedWithoutHuman}</dd>
          <dt className="text-slate-500">Intervenciones</dt><dd className="text-right text-slate-200">{report.totals.interventions}</dd>
          <dt className="text-slate-500">Tokens entrada / salida</dt><dd className="text-right text-slate-200">{report.totals.inputTokens.toLocaleString('es')} / {report.totals.outputTokens.toLocaleString('es')}</dd>
          <dt className="text-slate-500">Tiempo de ejecución</dt><dd className="text-right text-slate-200">{(report.totals.durationMs / 60_000).toFixed(1)} min</dd>
        </dl>
        <button type="button" onClick={() => void act(async () => setExported((await window.workspaceIpc.commands.exportFeatureReport(projectId, featureId)).path))} disabled={busy} className="min-h-8 w-full rounded border border-slate-600 px-3 text-xs text-slate-200 disabled:opacity-50">Exportar informe</button>
        {exported && <p role="status" className="break-all text-[10px] text-emerald-300">Informe guardado en {exported}</p>}
      </div>}
    </details>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
  </section>;
}

function text(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
