import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ActivityItemDto, ActivityKind, ActivitySummaryDto, ActivityTarget } from '../../../shared/contracts/activity-view.js';
import { notifyAttention } from '../../platform/notifications.js';

export interface ActivityNavigation { view: ActivityTarget; workItemId?: string | null; executionId?: string | null; changeSetId?: string | null }

const actionLabel: Record<ActivityKind, string> = {
  TASK_READY: 'Lanzar', TASK_RUNNING: 'Ver progreso', TASK_IN_REVIEW: 'Revisar', TASK_DONE: 'Ver en el grafo', TASK_FAILED: 'Ver qué pasó',
  PILOT_WAITING: 'Decidir y reanudar', PILOT_PAUSED: 'Ver piloto', PILOT_COMPLETED: 'Ver resumen',
  PLAN_PROPOSAL: 'Ver propuesta', PLAN_CHANGED: 'Ver en el grafo', APPROVAL_PENDING: 'Responder',
};
const REFRESH_DELAY_MS = 200;

/** Activity summary of a project, refreshed on core events; notifies new items needing attention while the window is in the background. */
export function useActivity(projectId: string): { summary: ActivitySummaryDto | null; loading: boolean; error: string | null; reload: () => Promise<void> } {
  const [summary, setSummary] = useState<ActivitySummaryDto | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const current = useRef(projectId);
  current.current = projectId;

  const reload = useCallback(async () => {
    const ipc = window.workspaceIpc;
    if (!ipc?.queries?.getActivity || !projectId) { setLoading(false); return; }
    try {
      const next = await ipc.queries.getActivity(projectId);
      if (current.current !== projectId) return;
      setSummary(next); setError(null);
      void notifyAttention(next.items, { windowFocused: typeof document !== 'undefined' && document.hasFocus() });
    } catch (reason) { if (current.current === projectId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current.current === projectId) setLoading(false); }
  }, [projectId]);

  useEffect(() => { setSummary(null); setLoading(true); void reload(); }, [reload]);
  useEffect(() => {
    const events = window.workspaceIpc?.events;
    if (!events) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void reload(), REFRESH_DELAY_MS); };
    const stops = [
      events.onGraphRevisionUpdated?.(event => { if (event.projectId === projectId) schedule(); }),
      events.onExecutionStatusChanged?.(() => schedule()),
      events.onPilotUpdated?.(event => { if (event.projectId === projectId) schedule(); }),
    ];
    return () => { clearTimeout(timer); for (const stop of stops) { try { stop?.(); } catch { /* ya cerrada */ } } };
  }, [projectId, reload]);

  return { summary, loading, error, reload };
}

interface InboxProps { projectId: string; onNavigate(target: ActivityNavigation): void; summary?: ActivitySummaryDto | null; loading?: boolean; error?: string | null }

/** Project activity inbox: what needs the user, what is running, and what happened lately.
 *  Si recibe `summary` (aunque sea null mientras carga) no consulta nada: el shell ya tiene la actividad y se evita la doble consulta. */
export function ActivityInbox(props: InboxProps) {
  return props.summary !== undefined ? <InboxView {...props} summary={props.summary} loading={props.loading ?? props.summary === null} error={props.error ?? null}/> : <LoadingInbox {...props}/>;
}

function LoadingInbox({ projectId, onNavigate }: InboxProps) {
  const { summary, loading, error } = useActivity(projectId);
  return <InboxView projectId={projectId} onNavigate={onNavigate} summary={summary} loading={loading} error={error}/>;
}

function InboxView({ onNavigate, summary, loading, error }: InboxProps & { summary: ActivitySummaryDto | null; loading: boolean; error: string | null }) {
  const items = summary?.items ?? [];
  const attention = items.filter(item => item.needsAttention);
  const running = items.filter(item => !item.needsAttention && item.kind === 'TASK_RUNNING');
  const recent = items.filter(item => !item.needsAttention && item.kind !== 'TASK_RUNNING');
  const open = (item: ActivityItemDto) => onNavigate({ view: item.target, workItemId: item.workItemId, executionId: item.executionId, changeSetId: item.changeSetId });

  return <section aria-label="Actividad del proyecto" aria-busy={loading} className="space-y-4 rounded-xl border border-border bg-surface-raised p-4">
    <h2 className="sr-only">Bandeja de actividad</h2>
    {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">No se pudo cargar la actividad: {error}</p>}
    {loading && !summary && <p className="text-xs text-fg-muted">Cargando actividad…</p>}
    {!loading && !error && !items.length && <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-xs text-fg-muted">Todo al día. Cuando haya tareas listas o en curso las verás aquí.</p>}
    {attention.length > 0 && <Group title="Requiere tu atención" count={attention.length} items={attention} onOpen={open} highlight/>}
    {running.length > 0 && <Group title="En curso" count={running.length} items={running} onOpen={open}/>}
    {recent.length > 0 && <Group title="Reciente" count={recent.length} items={recent} onOpen={open}/>}
  </section>;
}

function Group({ title, count, items, onOpen, highlight = false }: { title: string; count: number; items: ActivityItemDto[]; onOpen(item: ActivityItemDto): void; highlight?: boolean }) {
  const headingId = useId();
  return <section aria-labelledby={headingId} className="space-y-2">
    <h3 id={headingId} className={`text-xs font-semibold ${highlight ? 'text-accent' : 'text-fg-muted'}`}>{title} <span className="font-normal text-fg-subtle">({count})</span></h3>
    <ul className="space-y-2">{items.map(item => <Entry key={item.id} item={item} onOpen={onOpen} highlight={highlight}/>)}</ul>
  </section>;
}

function Entry({ item, onOpen, highlight }: { item: ActivityItemDto; onOpen(item: ActivityItemDto): void; highlight: boolean }) {
  const titleId = useId(), when = relativeTime(item.at);
  return <li className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${highlight ? 'border-accent/40 bg-accent-soft' : 'border-border bg-surface-sunken'}`}>
    <div className="min-w-0 flex-1">
      <p id={titleId} className="text-sm font-medium text-fg">{item.title}</p>
      {item.detail && <p className="mt-0.5 text-xs text-fg-muted">{item.detail}</p>}
      {when && <p className="mt-0.5 text-[11px] text-fg-subtle"><time dateTime={item.at}>{when}</time></p>}
    </div>
    <button type="button" aria-describedby={titleId} onClick={() => onOpen(item)} className={`min-h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${highlight ? 'border-accent/60 bg-surface-raised text-accent hover:border-accent' : 'border-border-strong text-fg hover:border-accent'}`}>{actionLabel[item.kind]}</button>
  </li>;
}

/** «hace 5 min», «hace 2 h», «ayer»… or '' when the date cannot be read. */
export function relativeTime(at: string, now = Date.now()): string {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return '';
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return new Date(time).toLocaleDateString('es');
}
