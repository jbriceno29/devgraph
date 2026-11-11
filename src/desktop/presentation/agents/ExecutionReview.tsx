import { useEffect, useState } from 'react';
import type { AgentExecutionDto, ExecutionDetailDto } from '../../../shared/contracts/agent-view.js';

const reviewLabel: Record<string, string> = {
  ACCEPTED: 'Aceptada e integrada',
  CHANGES_REQUESTED: 'Se pidieron ajustes',
  MERGE_CONFLICT: 'Conflicto al integrar',
};

/** Review of a completed run: what changed, how it was verified, and accept / request changes. */
export function ExecutionReview({ execution, models, defaultModel, onChanged }: {
  execution: AgentExecutionDto;
  models: string[];
  defaultModel: string | null;
  onChanged(next: AgentExecutionDto): void;
}) {
  const [detail, setDetail] = useState<ExecutionDetailDto | null>(null);
  const [feedback, setFeedback] = useState('');
  const [model, setModel] = useState(defaultModel ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    void window.workspaceIpc.queries.getExecutionDetail(execution.id)
      .then(result => { if (current) setDetail(result); })
      .catch(reason => { if (current) setMessage({ tone: 'error', text: errorText(reason) }); });
    return () => { current = false; };
  }, [execution.id, execution.status, execution.reviewStatus]);
  useEffect(() => { setModel(defaultModel ?? ''); }, [defaultModel]);

  const accept = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await window.workspaceIpc.commands.acceptExecution(execution.id);
      setMessage(result.merged
        ? { tone: 'ok', text: `Integrada en ${result.execution.baseBranch} (commit ${result.execution.mergedCommit?.slice(0, 8)}). La tarea pasó a DONE.` }
        : { tone: 'error', text: [result.conflict?.detail, ...(result.conflict?.files ?? []).map(file => `· ${file}`)].filter(Boolean).join('\n') });
      onChanged(result.execution);
    } catch (reason) { setMessage({ tone: 'error', text: errorText(reason) }); }
    finally { setBusy(false); }
  };

  const requestChanges = async () => {
    if (!feedback.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const next = await window.workspaceIpc.commands.requestExecutionChanges({ executionId: execution.id, feedback: feedback.trim(), ...(model ? { model } : {}) });
      setFeedback('');
      onChanged(next);
    } catch (reason) { setMessage({ tone: 'error', text: errorText(reason) }); }
    finally { setBusy(false); }
  };

  if (!detail) return message ? <p role="alert" className="m-4 text-xs text-rose-300">{message.text}</p> : null;
  const status = execution.reviewStatus ? reviewLabel[execution.reviewStatus] : detail.canAccept ? 'Pendiente de revisión' : 'Sin revisión';

  return <section aria-label="Revisión de la ejecución" className="space-y-3 border-t border-slate-800 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-200">Revisión</h3>
      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] text-slate-300">{status}</span>
    </div>
    <p className="text-[10px] text-slate-500">Rama de integración: <span className="font-mono text-slate-300">{execution.baseBranch ?? '—'}</span>{execution.mergedCommit && <> · commit integrado <span className="font-mono text-slate-300">{execution.mergedCommit.slice(0, 8)}</span></>}</p>
    {execution.reviewStatus === 'CHANGES_REQUESTED' && execution.reviewNote && <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-400">Ajustes pedidos: {execution.reviewNote}</p>}

    <div>
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Archivos ({detail.files.length})</h4>
      {detail.files.length === 0 ? <p className="text-xs text-slate-600">La ejecución no cambió archivos.</p> :
        <ul className="space-y-1.5">{detail.files.map(file => <li key={file.path}>
          <details className="rounded-lg border border-slate-800 bg-slate-950/60">
            <summary className="cursor-pointer px-3 py-2 text-xs text-slate-300"><span className="mr-2 text-[10px] text-cyan-300">{file.changeType}</span><span className="font-mono">{file.path}</span> <span className="text-emerald-400">+{file.additions}</span> <span className="text-rose-400">−{file.deletions}</span></summary>
            <pre className="max-h-80 overflow-auto border-t border-slate-800 p-3 text-[10px] leading-relaxed text-slate-300">{file.patch ?? 'Contenido omitido (ruta prohibida por la política).'}</pre>
          </details>
        </li>)}</ul>}
    </div>

    {detail.deniedActions.length > 0 && <div>
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">Acciones denegadas ({detail.deniedActions.length})</h4>
      <ul className="space-y-1 text-xs text-amber-200/80">{detail.deniedActions.map((action, index) => <li key={index}><span className="font-semibold">{action.toolName}</span>{action.target ? `: ${action.target}` : ''}</li>)}</ul>
    </div>}

    {detail.testLog && <details className="rounded-lg border border-slate-800 bg-slate-950/60">
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-300">Log de verificación</summary>
      <pre className="max-h-64 overflow-auto border-t border-slate-800 p-3 text-[10px] text-slate-400">{detail.testLog}</pre>
    </details>}

    {detail.canAccept && <button type="button" onClick={() => void accept()} disabled={busy} className="min-h-10 w-full rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">{`Aceptar e integrar en ${execution.baseBranch ?? 'la rama de la feature'}`}</button>}

    {detail.canRequestChanges && <div className="space-y-2">
      <label htmlFor={`feedback-${execution.id}`} className="block text-xs text-slate-400">¿Qué hay que ajustar?</label>
      <textarea id={`feedback-${execution.id}`} value={feedback} onChange={event => setFeedback(event.target.value)} rows={3} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400" placeholder="Ej. Falta validar títulos de más de 200 caracteres." />
      {models.length > 0 && <div><label htmlFor={`review-model-${execution.id}`} className="mb-1 block text-xs text-slate-400">Modelo para los ajustes</label>
        <select id={`review-model-${execution.id}`} value={model} onChange={event => setModel(event.target.value)} className="min-h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100">{models.map(option => <option key={option} value={option}>{option}{option === defaultModel ? ' (predeterminado)' : ''}</option>)}</select></div>}
      <button type="button" onClick={() => void requestChanges()} disabled={busy || !feedback.trim()} className="min-h-10 w-full rounded-lg border border-cyan-700 px-4 text-sm text-cyan-200 hover:bg-cyan-950 disabled:opacity-50">Pedir ajustes</button>
    </div>}

    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`whitespace-pre-wrap rounded-lg border p-3 text-xs ${message.tone === 'error' ? 'border-rose-900/70 bg-rose-950/40 text-rose-300' : 'border-emerald-900/70 bg-emerald-950/30 text-emerald-200'}`}>{message.text}</p>}
  </section>;
}

function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
