import { useState } from 'react';
import type { AgentExecutionDto } from '../../../shared/contracts/agent-view.js';
import { errorText } from '../errors.js';
import { primary } from '../ui.js';

/**
 * Plan S2: a run stopped because it needs packages outside the stack profile. Approving them lets the app install them
 * on the next run (relaunch the task or resume the pilot); the agent never installs anything itself.
 */
export function DependencyApproval({ execution }: { execution: AgentExecutionDto }) {
  const packages = execution.pendingPackages ?? [];
  const [state, setState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const approve = window.workspaceIpc.commands.approveDependencies;
  if (!packages.length) return null;
  const run = async () => {
    if (!approve) return;
    setBusy(true); setState(null);
    try { await approve(execution.projectId, packages); setState({ tone: 'ok', text: 'Aprobados. La app los instalará en la próxima ejecución: vuelve a lanzar la tarea o reanuda el piloto.' }); }
    catch (reason) { setState({ tone: 'error', text: errorText(reason) }); }
    finally { setBusy(false); }
  };
  return <div role="region" aria-label="Dependencias sin aprobar" className="rounded-xl border border-warning/50 bg-warning-soft p-3 text-xs text-fg">
    <p className="font-semibold">La ejecución necesita paquetes que no están en el perfil del proyecto</p>
    <p className="mt-1 font-mono text-[11px]">{packages.join(', ')}</p>
    <p className="mt-1 text-fg-muted">Si los apruebas, la app los instalará (sin ejecutar sus scripts) y el agente podrá usarlos. Si no, relanza la tarea y el agente buscará otra forma.</p>
    {approve && !state?.tone && <button type="button" className={`${primary} mt-2`} disabled={busy} onClick={() => void run()}>{busy ? 'Aprobando…' : `Aprobar ${packages.length === 1 ? 'el paquete' : `los ${packages.length} paquetes`}`}</button>}
    {state && <p role={state.tone === 'error' ? 'alert' : 'status'} className={`mt-2 ${state.tone === 'error' ? 'text-danger' : 'text-success'}`}>{state.text}</p>}
  </div>;
}
