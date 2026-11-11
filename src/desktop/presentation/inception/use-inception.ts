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
  // Cada lectura o acción toma un número al empezar; su respuesta solo se aplica si no se aplicó ya otra que empezó después,
  // para que una lectura lenta no pise el estado que devolvió una acción o un aviso posterior.
  const started = useRef(0), applied = useRef(0);
  const fresh = (request: number) => { if (request < applied.current) return false; applied.current = request; return true; };

  const reload = useCallback(async () => {
    if (!client) return;
    const request = ++started.current;
    try { const next = await client.get(projectId); if (current.current === projectId && fresh(request)) { setView(next); setLoadError(null); } }
    catch (reason) { if (current.current === projectId && request >= applied.current) setLoadError(reason); }
  }, [client, projectId]);
  useEffect(() => { setView(null); setActionError(null); void reload(); }, [reload]);
  useEffect(() => client?.onUpdated(event => { if (event.projectId === projectId) void reload(); }), [client, projectId, reload]);
  useEffect(() => { if (view?.status !== 'WORKING') return; const timer = setInterval(() => void reload(), INCEPTION_POLL_MS); return () => clearInterval(timer); }, [view?.status, reload]);

  /** Ejecuta una acción del asistente; devuelve false si falló (el error queda en `actionError`). */
  const act = useCallback(async (work: (ipc: InceptionIpcClient) => Promise<InceptionViewDto | void>) => {
    if (!client) return false;
    setBusy(true); setActionError(null);
    const request = ++started.current;
    try { const next = await work(client); if (next && current.current === projectId && fresh(request)) setView(next); return true; }
    catch (reason) { setActionError(reason); return false; }
    finally { setBusy(false); }
  }, [client, projectId]);

  return { client, view, loadError, actionError, setActionError, busy, reload, act };
}
