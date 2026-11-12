import { useEffect, useState } from 'react';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { errorText } from '../errors.js';
import { control } from '../ui.js';

/** Cómo se autentica el motor (suscripción o clave de API). Es del proyecto; el núcleo lo informa junto al estado del piloto de una feature. */
export function EngineAuthForm({ projectId, nodes }: { projectId: string; nodes: GraphNodeView[] }) {
  // Works in a project without features (the project-start assistant uses the same setting); clients without the dedicated
  // query fall back to the pilot state of the first feature.
  const featureId = nodes.find(node => node.type === 'FEATURE' && node.status !== 'ARCHIVED')?.id ?? '';
  const [auth, setAuth] = useState<{ authMode: 'subscription' | 'api_key'; apiKeyAvailable: boolean } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setAuth(null);
    const queries = window.workspaceIpc.queries;
    const load = queries.getProviderAuth
      ? queries.getProviderAuth(projectId)
      : featureId
        ? queries.getFeaturePilot(projectId, featureId)
        : null;
    if (!load) return;
    void load
      .then(state => {
        if (current) setAuth({ authMode: state.authMode, apiKeyAvailable: state.apiKeyAvailable });
      })
      .catch(reason => {
        if (current) setError(errorText(reason));
      });
    return () => {
      current = false;
    };
  }, [projectId, featureId]);
  const change = async (authMode: 'subscription' | 'api_key') => {
    setBusy(true);
    setError(null);
    try {
      const saved = await window.workspaceIpc.commands.setAuthMode(projectId, authMode);
      setAuth(previous => previous && { ...previous, authMode: saved?.authMode ?? authMode });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2 rounded-xl border border-border p-4">
      <h3 id="engine-auth-heading" className="text-xs font-semibold text-fg">
        Autenticación del motor
      </h3>
      {!auth ? (
        !error &&
        (window.workspaceIpc.queries.getProviderAuth || featureId) && <p className="text-xs text-fg-muted">Cargando…</p>
      ) : (
        <>
          <select
            id="engine-auth"
            aria-labelledby="engine-auth-heading"
            value={auth.authMode}
            disabled={busy}
            onChange={event => void change(event.target.value as 'subscription' | 'api_key')}
            className={control}
          >
            <option value="subscription">Suscripción (con pausas por límite)</option>
            <option value="api_key" disabled={!auth.apiKeyAvailable}>
              Clave de API{auth.apiKeyAvailable ? '' : ' (define ANTHROPIC_API_KEY al abrir la app)'}
            </option>
          </select>
          <p className="text-[11px] text-fg-subtle">
            {auth.authMode === 'subscription'
              ? 'Con suscripción, las ejecuciones largas se pausan al acercarse al límite de uso.'
              : 'Con clave de API, cada ejecución se cobra por uso.'}
          </p>
        </>
      )}
      {!auth && !error && !window.workspaceIpc.queries.getProviderAuth && !featureId && (
        <p className="text-xs text-fg-muted">Disponible cuando el proyecto tenga al menos una feature.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
