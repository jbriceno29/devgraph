import { useEffect, useState } from 'react';
import type { ExecutionPolicyDto } from '../../../shared/contracts/agent-view.js';

type Field = 'writablePaths' | 'readonlyPaths' | 'deniedPaths' | 'allowedCommands';
const fields: Array<{ key: Field; label: string; hint: string }> = [
  { key: 'writablePaths', label: 'Rutas escribibles', hint: 'Una por línea, p. ej. src/**' },
  { key: 'readonlyPaths', label: 'Rutas de solo lectura', hint: 'El agente puede leerlas, no cambiarlas.' },
  { key: 'deniedPaths', label: 'Rutas prohibidas', hint: 'Ni lectura ni escritura, p. ej. .env*' },
  { key: 'allowedCommands', label: 'Comandos de verificación', hint: 'Uno por línea, sin tuberías, p. ej. npm test. Se ejecutan al validar.' },
];

/** Edits the project's execution policy: what the agent may write and which checks validate its work. */
export function ExecutionPolicyForm({ projectId }: { projectId: string }) {
  const [values, setValues] = useState<Record<Field, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    void window.workspaceIpc.queries.getExecutionPolicy(projectId)
      .then(policy => { if (current) { setValues(toText(policy)); setMinutes(String(policy.maxExecutionMinutes ?? 30)); } })
      .catch(reason => { if (current) setMessage({ tone: 'error', text: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { current = false; };
  }, [projectId]);

  const save = async () => {
    if (!values) return;
    setBusy(true); setMessage(null);
    try {
      const saved = await window.workspaceIpc.commands.updateExecutionPolicy(projectId, {
        writablePaths: lines(values.writablePaths), readonlyPaths: lines(values.readonlyPaths), deniedPaths: lines(values.deniedPaths), allowedCommands: lines(values.allowedCommands), maxExecutionMinutes: Number(minutes),
      });
      setValues(toText(saved));
      setMessage({ tone: 'ok', text: saved.allowedCommands.length ? 'Política guardada.' : 'Política guardada. Sin comandos de verificación, las ejecuciones no se prueban automáticamente.' });
    } catch (reason) { setMessage({ tone: 'error', text: reason instanceof Error ? reason.message : String(reason) }); }
    finally { setBusy(false); }
  };

  return <details className="rounded-xl border border-slate-800 bg-slate-900/30">
    <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-300">Política de ejecución</summary>
    <div className="space-y-3 border-t border-slate-800 p-4">
      {!values ? <p className="text-xs text-slate-500">Cargando…</p> : fields.map(field => <div key={field.key}>
        <label htmlFor={`policy-${field.key}`} className="mb-1 block text-xs text-slate-400">{field.label}</label>
        <textarea id={`policy-${field.key}`} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })} rows={field.key === 'writablePaths' ? 4 : 2} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400" />
        <p className="mt-0.5 text-[10px] text-slate-600">{field.hint}</p>
      </div>)}
      {values && <div>
        <label htmlFor="policy-max-minutes" className="mb-1 block text-xs text-slate-400">Tiempo máximo por ejecución (minutos)</label>
        <input id="policy-max-minutes" type="number" min={1} max={240} value={minutes} onChange={event => setMinutes(event.target.value)} className="min-h-9 w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100" />
      </div>}
      <button type="button" onClick={() => void save()} disabled={busy || !values} className="min-h-9 w-full rounded-lg border border-slate-600 px-3 text-xs text-slate-200 hover:border-slate-400 disabled:opacity-50">Guardar política</button>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>{message.text}</p>}
    </div>
  </details>;
}

function toText(policy: ExecutionPolicyDto): Record<Field, string> {
  return { writablePaths: policy.writablePaths.join('\n'), readonlyPaths: policy.readonlyPaths.join('\n'), deniedPaths: policy.deniedPaths.join('\n'), allowedCommands: policy.allowedCommands.join('\n') };
}
function lines(text: string): string[] { return text.split('\n').map(line => line.trim()).filter(Boolean); }
