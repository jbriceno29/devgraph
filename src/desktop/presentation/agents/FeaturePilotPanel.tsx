import { useCallback, useEffect, useState } from 'react';
import { useUnsavedChanges } from '../../state/unsaved-changes.js';
import type { AutonomyLevelDto, FeaturePilotDto, FeatureReportDto } from '../../../shared/contracts/agent-view.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { statusLabel as workStatus } from '../labels.js';
import { errorText } from '../errors.js';
import { control, danger, focusRing, primary, secondary } from '../ui.js';
import { FeatureIntegration } from './FeatureIntegration.js';
import { planTaskGroups } from '../../../shared/task-grouping.js';

const levels: Array<{ value: AutonomyLevelDto; label: string; help: string }> = [
  { value: 'MANUAL', label: 'Manual', help: 'Tú lanzas cada tarea y decides qué integrar.' },
  {
    value: 'AUTO_ACCEPT',
    label: 'Auto-aceptar',
    help: 'Tú lanzas las tareas; las que pasan auditoría y pruebas se integran solas.',
  },
  {
    value: 'PILOT',
    label: 'Piloto',
    help: 'Recorre las tareas de la feature, las ejecuta, verifica e integra; te avisa solo cuando hace falta.',
  },
];
const kindLabel: Record<string, string> = { PLAN_CHANGED: 'Plan modificado', PLAN_PROPOSAL: 'Propuesta de cambios' };
const statusLabel: Record<string, string> = {
  RUNNING: 'En marcha',
  PAUSED: 'En pausa',
  WAITING_USER: 'Esperándote',
  COMPLETED: 'Feature terminada',
  STOPPED: 'Detenido',
  FAILED: 'Error',
};

type AutonomyDraft = ReturnType<typeof draftOf>;
/** The editable form of a feature's autonomy (numbers as text, as the inputs hold them). */
const draftOf = (autonomy: FeaturePilotDto['autonomy']) => ({
  level: autonomy.level,
  executionModel: autonomy.executionModel ?? '',
  escalationModel: autonomy.escalationModel ?? '',
  maxAttempts: String(autonomy.maxAttempts),
  threshold: String(Math.round(autonomy.usagePauseThreshold * 100)),
  groupTasks: autonomy.groupTasks,
  maxGroupSize: String(autonomy.maxGroupSize),
  reviewModel: autonomy.reviewModel ?? '',
});

/** Autonomy per feature and the autopilot's controls, status and decision log. */
export function FeaturePilotPanel({ projectId, nodes }: { projectId: string; nodes: GraphNodeView[] }) {
  const features = nodes.filter(node => node.type === 'FEATURE');
  const [featureId, setFeatureId] = useState(features[0]?.id ?? '');
  const [state, setState] = useState<FeaturePilotDto | null>(null);
  const [draft, setDraft] = useState<AutonomyDraft | null>(null);
  const [confirming, setConfirming] = useState(false),
    [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FeatureReportDto['report'] | null>(null),
    [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    if (!features.some(feature => feature.id === featureId)) setFeatureId(features[0]?.id ?? '');
  }, [features, featureId]);

  const load = useCallback(async () => {
    if (!featureId) return;
    try {
      const next = await window.workspaceIpc.queries.getFeaturePilot(projectId, featureId);
      setState(next);
      setDraft(current => (current && current.level === next.autonomy.level ? current : draftOf(next.autonomy)));
    } catch (reason) {
      setError(text(reason));
    }
  }, [projectId, featureId]);
  useEffect(() => {
    setDraft(null);
    setState(null);
    void load();
  }, [load]);
  useEffect(
    () =>
      window.workspaceIpc.events.onPilotUpdated(event => {
        if (event.featureId === featureId) void load();
      }),
    [featureId, load],
  );

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    draft &&
    act(async () => {
      const saved = await window.workspaceIpc.commands.setFeatureAutonomy(projectId, featureId, {
        level: draft.level,
        executionModel: draft.executionModel || null,
        escalationModel: draft.escalationModel || null,
        maxAttempts: Number(draft.maxAttempts),
        usagePauseThreshold: Number(draft.threshold) / 100,
        groupTasks: draft.groupTasks,
        maxGroupSize: Number(draft.maxGroupSize),
        reviewModel: draft.reviewModel || null,
      });
      setDraft(draftOf(saved));
    });

  useUnsavedChanges(
    'la autonomía de la feature',
    Boolean(draft && state && JSON.stringify(draft) !== JSON.stringify(draftOf(state.autonomy))),
  );
  const integrateFeature = window.workspaceIpc.commands.integrateFeature;
  const integrate = integrateFeature ? () => integrateFeature(projectId, featureId) : undefined;

  if (!features.length)
    return (
      <p className="rounded-xl border border-dashed border-border-strong p-4 text-xs text-fg-muted">
        El piloto trabaja por features. Crea una en Planificar para poder usarlo.
      </p>
    );
  const run = state?.run ?? null;
  const active = run && ['RUNNING', 'PAUSED'].includes(run.status);
  const remaining = state?.tasks.filter(task => !['DONE', 'ARCHIVED'].includes(task.status)) ?? [];
  // Etapa 0: with grouping on, the pilot closes the remaining tasks in fewer executions (same rules as the core).
  const grouping = Boolean(state && state.autonomy.groupTasks && state.autonomy.maxGroupSize > 1);
  const plannedRuns =
    state && grouping
      ? planTaskGroups(state.tasks, {
          maxGroupSize: state.autonomy.maxGroupSize,
          projectHasDoneTasks: nodes.some(node => node.type === 'WORK_ITEM' && node.status === 'DONE'),
        }).length
      : remaining.length;
  const usage =
    state?.usage?.utilization != null
      ? `${Math.round(state.usage.utilization * 100)} % de la ventana ${state.usage.window === 'five_hour' ? 'de 5 h' : state.usage.window}`
      : 'sin datos todavía';

  const small = 'mb-1 block text-[11px] text-fg-muted';
  return (
    <section
      aria-label="Autonomía de la feature"
      className="space-y-3 rounded-xl border border-pilot-border/60 bg-surface-raised p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-pilot">Autonomía de la feature</h3>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          Decide cuánto trabaja el agente solo en una feature. La política y la autenticación están en Ajustes.
        </p>
      </div>
      <div>
        <label htmlFor="pilot-feature" className="mb-1 block text-xs text-fg-muted">
          Feature
        </label>
        <select
          id="pilot-feature"
          value={featureId}
          onChange={event => setFeatureId(event.target.value)}
          className={control}
        >
          {features.map(feature => (
            <option key={feature.id} value={feature.id}>
              {feature.key} · {feature.label}
            </option>
          ))}
        </select>
      </div>

      {state && draft && (
        <>
          <p className="text-[11px] text-fg-muted">
            {state.tasks.length} tareas · {remaining.length} pendientes
            {remaining.length
              ? `: ${remaining.map(task => `${task.displayKey} (${workStatus(task.status).toLowerCase()})`).join(', ')}`
              : ''}
          </p>
          <FeatureIntegration
            featureKey={features.find(feature => feature.id === featureId)?.key ?? 'La feature'}
            state={state.integration}
            onIntegrate={integrate}
            onDone={() => void load()}
          />
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-fg-muted">Nivel</legend>
            {levels.map(level => (
              <label
                key={level.value}
                className="flex min-h-9 items-start gap-2 rounded-lg px-1 py-1 text-xs text-fg hover:bg-surface-sunken"
              >
                <input
                  type="radio"
                  name="autonomy-level"
                  value={level.value}
                  checked={draft.level === level.value}
                  onChange={() => setDraft({ ...draft, level: level.value })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-semibold">{level.label}</span> ·{' '}
                  <span className="text-fg-muted">{level.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {draft.level !== 'MANUAL' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="pilot-model" className={small}>
                  Modelo de ejecución
                </label>
                <select
                  id="pilot-model"
                  value={draft.executionModel}
                  onChange={event => setDraft({ ...draft, executionModel: event.target.value })}
                  className={control}
                >
                  <option value="">Predeterminado</option>
                  {state.availableModels.map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pilot-escalation" className={small}>
                  Modelo del último intento
                </label>
                <select
                  id="pilot-escalation"
                  value={draft.escalationModel}
                  onChange={event => setDraft({ ...draft, escalationModel: event.target.value })}
                  className={control}
                >
                  <option value="">El mismo</option>
                  {state.availableModels.map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pilot-attempts" className={small}>
                  Intentos por tarea
                </label>
                <input
                  id="pilot-attempts"
                  type="number"
                  min={1}
                  max={5}
                  value={draft.maxAttempts}
                  onChange={event => setDraft({ ...draft, maxAttempts: event.target.value })}
                  className={control}
                />
              </div>
              <div>
                <label htmlFor="pilot-threshold" className={small}>
                  Pausar al llegar al (%)
                </label>
                <input
                  id="pilot-threshold"
                  type="number"
                  min={50}
                  max={99}
                  value={draft.threshold}
                  onChange={event => setDraft({ ...draft, threshold: event.target.value })}
                  className={control}
                />
              </div>
              {draft.level === 'PILOT' && (
                <div className="col-span-2">
                  <label htmlFor="pilot-review" className={small}>
                    Revisión independiente antes de aceptar
                  </label>
                  <select
                    id="pilot-review"
                    value={draft.reviewModel}
                    onChange={event => setDraft({ ...draft, reviewModel: event.target.value })}
                    className={control}
                  >
                    <option value="">Sin revisión</option>
                    {state.availableModels.map(model => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Otro modelo lee el diff contra los criterios de cada tarea; si algo no se cumple, el piloto pide
                    ajustes con sus hallazgos. Añade una llamada por ejecución.
                  </p>
                </div>
              )}
            </div>
          )}
          {draft.level === 'PILOT' && (
            <div className="space-y-1.5 rounded-lg border border-border bg-surface-sunken p-2">
              <label className="flex min-h-9 items-start gap-2 text-xs text-fg">
                <input
                  type="checkbox"
                  checked={draft.groupTasks}
                  onChange={event => setDraft({ ...draft, groupTasks: event.target.checked })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-semibold">Agrupar tareas pequeñas</span>{' '}
                  <span className="rounded bg-success-soft px-1 text-[10px] font-medium uppercase text-success">
                    recomendado
                  </span>{' '}
                  ·{' '}
                  <span className="text-fg-muted">
                    Junta 2 o 3 tareas listas de la feature en una sola ejecución. Medido con el piloto: ~19 % menos de
                    costo con la misma calidad usando grupos de 3; con grupos de 4 se perdió la convención del proyecto,
                    así que no subas de 3 sin medirlo. La tarea que fija una convención siempre va sola.
                  </span>
                </span>
              </label>
              {draft.groupTasks && (
                <div>
                  <label htmlFor="pilot-group-size" className={small}>
                    Tareas por ejecución (máximo)
                  </label>
                  <input
                    id="pilot-group-size"
                    type="number"
                    min={1}
                    max={5}
                    value={draft.maxGroupSize}
                    onChange={event => setDraft({ ...draft, maxGroupSize: event.target.value })}
                    className={control}
                  />
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className={`min-h-9 w-full text-xs ${secondary}`}
          >
            Guardar autonomía
          </button>

          {state.autonomy.level === 'PILOT' && !active && !confirming && (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
                setAcknowledged(false);
              }}
              disabled={busy || !remaining.length}
              className={`min-h-10 w-full text-sm ${primary}`}
            >
              {run && ['PAUSED', 'WAITING_USER'].includes(run.status) ? 'Iniciar un piloto nuevo' : 'Iniciar piloto'}
            </button>
          )}
          {state.autonomy.level !== 'PILOT' && !active && (
            <p className="text-[11px] text-fg-subtle">
              Para que el piloto recorra la feature solo, elige el nivel «Piloto» y guarda.
            </p>
          )}
          {confirming && (
            <div
              role="group"
              aria-label="Aviso de costo"
              className="space-y-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-xs text-fg"
            >
              <p className="font-semibold text-warning">El piloto encadena ejecuciones y consume tu límite de uso.</p>
              <p>
                Quedan {remaining.length} tareas en esta feature
                {grouping
                  ? `, en ~${plannedRuns} ${plannedRuns === 1 ? 'ejecución' : 'ejecuciones'} (agrupando hasta ${state.autonomy.maxGroupSize} tareas pequeñas por ejecución)`
                  : ''}
                ; cada {grouping ? 'ejecución' : 'una'} puede intentarse hasta {state.autonomy.maxAttempts} veces
                {state.autonomy.executionModel ? ` con ${state.autonomy.executionModel}` : ''}. Uso actual: {usage}.{' '}
                {state.authMode === 'subscription'
                  ? `Con suscripción, el piloto se pausará al llegar al ${Math.round(state.autonomy.usagePauseThreshold * 100)} % y seguirá cuando se renueve la ventana. Para uso intensivo conviene una clave de API del proveedor (se cobra por uso).`
                  : 'Con clave de API, cada ejecución se cobra por uso.'}
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={event => setAcknowledged(event.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>Entiendo el costo y quiero que el piloto trabaje solo en esta feature.</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void act(async () => {
                      await window.workspaceIpc.commands.startPilot(projectId, featureId, { acknowledgeCost: true });
                      setConfirming(false);
                    })
                  }
                  disabled={!acknowledged || busy}
                  className={`min-h-9 flex-1 text-xs ${primary}`}
                >
                  Iniciar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={`min-h-9 flex-1 text-xs ${secondary}`}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {active && (
            <button
              type="button"
              onClick={() => void act(() => window.workspaceIpc.commands.stopPilot(projectId, featureId))}
              disabled={busy}
              className={`min-h-9 w-full text-xs ${danger}`}
            >
              Detener piloto
            </button>
          )}
          {run && ['PAUSED', 'WAITING_USER'].includes(run.status) && (
            <button
              type="button"
              onClick={() => void act(() => window.workspaceIpc.commands.resumePilot(projectId, featureId))}
              disabled={busy}
              className={`min-h-9 w-full text-xs ${secondary}`}
            >
              Reanudar piloto
            </button>
          )}

          {run && (
            <p role="status" className="rounded-lg border border-pilot-border/60 bg-pilot-soft p-2 text-xs text-fg">
              <span className="font-semibold text-pilot">{statusLabel[run.status] ?? run.status}</span>
              {run.reason ? ` · ${run.reason}` : ''}
            </p>
          )}
          {state.events.length > 0 && (
            <ol aria-label="Decisiones del piloto" className="max-h-56 space-y-1 overflow-y-auto">
              {[...state.events]
                .reverse()
                .slice(0, 30)
                .map(event => (
                  <li key={event.id} className="text-[11px] text-fg-muted">
                    <span className="text-fg-subtle">{new Date(event.createdAt).toLocaleTimeString('es')}</span>{' '}
                    <span className="font-medium text-pilot">{kindLabel[event.kind] ?? eventKind(event.kind)}</span>{' '}
                    {event.message}
                  </li>
                ))}
            </ol>
          )}
        </>
      )}
      {state && (
        <details
          className="rounded-lg border border-border bg-surface-sunken"
          onToggle={event => {
            if ((event.target as HTMLDetailsElement).open)
              void act(async () =>
                setReport((await window.workspaceIpc.queries.getFeatureReport(projectId, featureId)).report),
              );
          }}
        >
          <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs text-fg ${focusRing}`}>
            Métricas de la feature
          </summary>
          {report && (
            <div className="space-y-2 border-t border-border p-3">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-fg-muted">Tareas cerradas</dt>
                <dd className="text-right text-fg">
                  {report.totals.done} de {report.totals.tasks}
                </dd>
                <dt className="text-fg-muted">Ejecuciones</dt>
                <dd className="text-right text-fg">{report.totals.executions}</dd>
                <dt className="text-fg-muted">Al primer intento</dt>
                <dd className="text-right text-fg">{report.totals.acceptedOnFirstAttempt}</dd>
                <dt className="text-fg-muted">Sin intervención</dt>
                <dd className="text-right text-fg">{report.totals.acceptedWithoutHuman}</dd>
                <dt className="text-fg-muted">Intervenciones</dt>
                <dd className="text-right text-fg">{report.totals.interventions}</dd>
                <dt className="text-fg-muted">Tokens entrada / salida</dt>
                <dd className="text-right text-fg">
                  {report.totals.inputTokens.toLocaleString('es')} / {report.totals.outputTokens.toLocaleString('es')}
                </dd>
                <dt className="text-fg-muted">Tiempo de ejecución</dt>
                <dd className="text-right text-fg">{(report.totals.durationMs / 60_000).toFixed(1)} min</dd>
              </dl>
              <button
                type="button"
                onClick={() =>
                  void act(async () =>
                    setExported((await window.workspaceIpc.commands.exportFeatureReport(projectId, featureId)).path),
                  )
                }
                disabled={busy}
                className={`min-h-9 w-full text-xs ${secondary}`}
              >
                Exportar informe
              </button>
              {exported && (
                <p role="status" className="break-all text-[11px] text-success">
                  Informe guardado en {exported}
                </p>
              )}
            </div>
          )}
        </details>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

const text = errorText;
const eventKind = (kind: string) =>
  kind
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, first => first.toUpperCase());
