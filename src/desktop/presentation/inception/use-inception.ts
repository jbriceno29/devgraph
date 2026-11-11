import { useCallback, useEffect, useRef, useState } from 'react';
import type { InceptionIpcClient, InceptionViewDto } from '../../../shared/contracts/inception-view.js';

/** Respaldo por si se pierde un aviso `inception:updated` mientras el motor trabaja. */
export const INCEPTION_POLL_MS = 10_000;

/** Estado del inicio de un proyecto: lo consulta al abrir, al recibir `onUpdated` y, mientras trabaja, cada pocos segundos. */
export function useInception(projectId: string) {
  const client: InceptionIpcClient | undefined = window.workspaceIpc?.inception;
  const [view, setView] = useState<InceptionViewDto | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null), [actionError, setActionError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const current = useRef(projectId);
  current.current = projectId;

  const reload = useCallback(async () => {
    if (!client) return;
    try { const next = await client.get(projectId); if (current.current === projectId) { setView(next); setLoadError(null); } }
    catch (reason) { if (current.current === projectId) setLoadError(reason); }
  }, [client, projectId]);
  useEffect(() => { setView(null); setActionError(null); void reload(); }, [reload]);
  useEffect(() => client?.onUpdated(event => { if (event.projectId === projectId) void reload(); }), [client, projectId, reload]);
  useEffect(() => { if (view?.status !== 'WORKING') return; const timer = setInterval(() => void reload(), INCEPTION_POLL_MS); return () => clearInterval(timer); }, [view?.status, reload]);

  /** Ejecuta una acción del asistente; devuelve false si falló (el error queda en `actionError`). */
  const act = useCallback(async (work: (ipc: InceptionIpcClient) => Promise<InceptionViewDto | void>) => {
    if (!client) return false;
    setBusy(true); setActionError(null);
    try { const next = await work(client); if (next && current.current === projectId) setView(next); return true; }
    catch (reason) { setActionError(reason); return false; }
    finally { setBusy(false); }
  }, [client, projectId]);

  return { client, view, loadError, actionError, setActionError, busy, reload, act };
}
