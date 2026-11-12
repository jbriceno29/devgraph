import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ExecutionReview } from './ExecutionReview.js';
import { DependencyApproval } from './DependencyApproval.js';
import { ProjectSkillsForm } from './ProjectSkillsForm.js';
import { ExecutionPolicyForm } from './ExecutionPolicyForm.js';
import { FeaturePilotPanel } from './FeaturePilotPanel.js';
import { EngineAuthForm } from './EngineAuthForm.js';
import { useResetOnChange } from '../use-reset-on-change.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import type { AgentEventRecordDto, AgentExecutionDto, AgentProfileDto } from '../../../shared/contracts/agent-view.js';
import { eventLabel, executionStatusLabel, shortDate } from '../labels.js';
import { ErrorNotice } from '../errors.js';
import { control, danger, focusRing, primary, secondary } from '../ui.js';

type Tab = 'run' | 'review' | 'pilot' | 'settings';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'run', label: 'Ejecutar' },
  { id: 'review', label: 'Revisión' },
  { id: 'pilot', label: 'Piloto' },
  { id: 'settings', label: 'Ajustes' },
];
const ACTIVE = ['QUEUED', 'PREPARING_CONTEXT', 'RUNNING', 'AWAITING_APPROVAL', 'VALIDATING'];
const actionLabel: Record<string, string> = {
  COMMAND: 'Ejecutar un comando',
  FILE_WRITE: 'Escribir un archivo',
  FILE_READ: 'Leer un archivo',
  NETWORK: 'Acceder a la red',
  UNKNOWN: 'Acción sin clasificar',
};

/** Agentes: ejecutar tareas listas, revisar su resultado, dejar que el piloto recorra una feature y ajustar la política. */
export function AgentsWorkspace({
  projectId,
  nodes,
  selectedEntityId,
  selectedExecutionId: requestedExecutionId,
}: {
  projectId: string;
  nodes: GraphNodeView[];
  selectedEntityId: string | null;
  selectedExecutionId?: string | null;
}) {
  const readyItems = useMemo(() => nodes.filter(node => node.type === 'WORK_ITEM' && node.status === 'READY'), [nodes]);
  const [profiles, setProfiles] = useState<AgentProfileDto[]>([]),
    [executions, setExecutions] = useState<AgentExecutionDto[]>([]),
    [events, setEvents] = useState<AgentEventRecordDto[]>([]);
  const [workItemId, setWorkItemId] = useState(''),
    [profileId, setProfileId] = useState(''),
    [model, setModel] = useState(''),
    [selectedExecutionId, setSelectedExecutionId] = useState(requestedExecutionId ?? '');
  const [loading, setLoading] = useState(true),
    [starting, setStarting] = useState(false),
    [error, setError] = useState<unknown>(null),
    [handledApprovalId, setHandledApprovalId] = useState(''),
    [tab, setTab] = useState<Tab>('run');
  const dialogRef = useRef<HTMLDialogElement>(null),
    tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ run: null, review: null, pilot: null, settings: null }),
    routed = useRef<string | null>(null);
  const selectedExecution = executions.find(item => item.id === selectedExecutionId) ?? null;
  const selectedProfile = profiles.find(item => item.id === profileId) ?? null;
  const availableModels = selectedProfile?.availableModels ?? [];
  const latestRateLimit =
    [...events].reverse().find(record => record.event.type === 'RATE_LIMIT_UPDATED')?.event ?? null;
  const pendingApproval =
    selectedExecution?.status === 'AWAITING_APPROVAL'
      ? ([...events]
          .reverse()
          .find(
            record =>
              record.event.type === 'APPROVAL_REQUIRED' && String(record.event.requestId ?? '') !== handledApprovalId,
          ) ?? null)
      : null;
  const toReview = executions.filter(item => item.status === 'COMPLETED' && !item.reviewStatus).length;
  const coveredOf = (execution: AgentExecutionDto) =>
    (execution.coveredWorkItemIds?.length ? execution.coveredWorkItemIds : [execution.workItemId]).flatMap(id => {
      const node = nodes.find(item => item.id === id);
      return node ? [node] : [];
    });
  const describeRun = (execution: AgentExecutionDto) =>
    `${
      coveredOf(execution)
        .map(node => node.key)
        .join(', ') || 'Tarea'
    } · ${executionStatusLabel(execution.status)}${shortDate(execution.startedAt) ? ` · ${shortDate(execution.startedAt)}` : ''}`;
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [availableProfiles, runs] = await Promise.all([
        window.workspaceIpc.queries.listAgentProfiles(projectId),
        window.workspaceIpc.queries.listExecutions(projectId),
      ]);
      setProfiles(availableProfiles);
      setExecutions(runs);
      setProfileId(current => current || availableProfiles.find(item => item.roleKey === 'DEVELOPER')?.id || '');
      setSelectedExecutionId(current => current || runs[0]?.id || '');
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [projectId]);
  // La ejecución que llega de la bandeja o del inspector: se selecciona y se abre la pestaña que corresponde (revisión si terminó).
  useEffect(() => {
    if (!requestedExecutionId) return;
    setSelectedExecutionId(requestedExecutionId);
    const target = executions.find(item => item.id === requestedExecutionId);
    if (!target || routed.current === requestedExecutionId) return;
    routed.current = requestedExecutionId;
    setTab(target.status === 'COMPLETED' ? 'review' : 'run');
  }, [requestedExecutionId, executions]);
  // En Revisión, si lo elegido no terminó, se propone la primera ejecución pendiente de revisar.
  useEffect(() => {
    if (tab !== 'review' || selectedExecution?.status === 'COMPLETED') return;
    const next = executions.find(item => item.status === 'COMPLETED' && !item.reviewStatus);
    if (next) setSelectedExecutionId(next.id);
  }, [tab]);
  // Preselecciona el modelo predeterminado cuando cambia el perfil (y con él el motor).
  useResetOnChange(`${selectedProfile?.id ?? ''}|${selectedProfile?.defaultModel ?? ''}`, () =>
    setModel(selectedProfile?.defaultModel ?? ''),
  );
  // La tarea elegida en el grafo se preselecciona cuando cambia; después el usuario puede elegir otra sin que se revierta.
  useResetOnChange(selectedEntityId, () => {
    if (readyItems.some(item => item.id === selectedEntityId)) setWorkItemId(selectedEntityId!);
  });
  useEffect(() => {
    if (readyItems.some(item => item.id === workItemId)) return;
    setWorkItemId(readyItems.find(item => item.id === selectedEntityId)?.id ?? readyItems[0]?.id ?? '');
  }, [readyItems, selectedEntityId, workItemId]);
  useEffect(() => {
    const unsubscribeStatus = window.workspaceIpc.events.onExecutionStatusChanged(event => {
      if (event.workItemId) {
        void window.workspaceIpc.queries.listExecutions(projectId).then(setExecutions).catch(setError);
      }
    });
    const unsubscribeEvent = window.workspaceIpc.events.onExecutionEventReceived(event => {
      if (event.executionId !== selectedExecutionId) return;
      void window.workspaceIpc.queries.listExecutionEvents(event.executionId).then(setEvents).catch(setError);
    });
    return () => {
      unsubscribeStatus();
      unsubscribeEvent();
    };
  }, [projectId, selectedExecutionId]);
  useEffect(() => {
    if (!selectedExecutionId) {
      setEvents([]);
      return;
    }
    let active = true;
    void window.workspaceIpc.queries
      .listExecutionEvents(selectedExecutionId)
      .then(records => {
        if (active) setEvents(records);
      })
      .catch(reason => {
        if (active) setError(reason);
      });
    return () => {
      active = false;
    };
  }, [selectedExecutionId]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pendingApproval && !dialog.open) {
      dialog.returnValue = '';
      dialog.showModal();
    } else if (!pendingApproval && dialog.open) dialog.close();
  }, [pendingApproval]);
  const start = async () => {
    if (!workItemId || !profileId) return;
    setStarting(true);
    setError(null);
    try {
      const execution = await window.workspaceIpc.commands.startExecution({
        projectId,
        workItemId,
        profileId,
        ...(model ? { model } : {}),
      });
      setSelectedExecutionId(execution.id);
      setExecutions(await window.workspaceIpc.queries.listExecutions(projectId));
    } catch (reason) {
      setError(reason);
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (!selectedExecution) return;
    setError(null);
    try {
      const updated = await window.workspaceIpc.commands.cancelExecution(selectedExecution.id);
      setExecutions(current => current.map(item => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setError(reason);
    }
  };
  const developerProfiles = profiles.filter(profile => profile.roleKey === 'DEVELOPER');
  const handleApprovalClose = () => {
    const dialog = dialogRef.current;
    if (!dialog || !pendingApproval || !selectedExecution) return;
    const approved = dialog.returnValue === 'approve';
    const requestId = String(pendingApproval.event.requestId ?? '');
    dialog.returnValue = '';
    setHandledApprovalId(requestId);
    setError(null);
    void window.workspaceIpc.commands
      .resolveExecutionApproval({
        executionId: selectedExecution.id,
        requestId,
        decision: approved
          ? { approved: true, scope: 'ONCE' }
          : { approved: false, reason: 'Aprobación rechazada o diálogo cerrado.' },
      })
      .then(() => window.workspaceIpc.queries.listExecutions(projectId).then(setExecutions))
      .catch(setError);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + TABS.length - 1) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };
  const history = (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor="execution-history" className="shrink-0 text-xs text-fg-muted">
        Ejecución
      </label>
      <select
        id="execution-history"
        value={selectedExecutionId}
        onChange={event => setSelectedExecutionId(event.target.value)}
        className={`${control} max-w-72`}
      >
        <option value="">Elige una ejecución</option>
        {executions.map(item => (
          <option key={item.id} value={item.id}>
            {describeRun(item)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
      aria-labelledby="agents-heading"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Ejecución de agentes</p>
          <h2 id="agents-heading" className="mt-0.5 text-base font-semibold text-fg">
            Monitor de tareas
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            El agente recibe el contexto del proyecto preparado para la tarea (fijo durante la ejecución); aquí sigues
            su actividad y revisas el resultado antes de integrarlo.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={`min-h-9 text-xs ${secondary}`}>
          Actualizar
        </button>
        <div role="tablist" aria-label="Secciones de Agentes" className="-mb-px flex w-full gap-1 overflow-x-auto">
          {TABS.map((item, index) => (
            <button
              key={item.id}
              ref={element => {
                tabRefs.current[item.id] = element;
              }}
              type="button"
              role="tab"
              id={`agents-tab-${item.id}`}
              aria-controls={`agents-panel-${item.id}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={event => onTabKey(event, index)}
              className={`flex min-h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-medium ${focusRing} ${tab === item.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
            >
              {item.label}
              {item.id === 'review' && toReview > 0 && (
                <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">
                  {toReview}
                  <span className="sr-only"> por revisar</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </header>
      {error !== null && <ErrorNotice error={error} className="mx-4 mt-3" />}
      <div
        id={`agents-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`agents-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {tab === 'run' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
            <div className="space-y-4">
              {readyItems.length === 0 && !loading && (
                <div className="rounded-xl border border-dashed border-border-strong bg-surface-sunken p-3 text-xs leading-5 text-fg-muted">
                  <p className="font-semibold text-fg">No hay tareas listas para ejecutar</p>
                  <p className="mt-1">
                    Abre el <strong>Grafo</strong>, elige una tarea en Borrador y, en el inspector, cambia su estado a{' '}
                    <strong>«Lista»</strong>. Si aún no tienes tareas, pídelas en <strong>Planificar</strong>.
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="agent-work-item" className="mb-1 block text-xs text-fg-muted">
                  Tarea lista
                </label>
                <select
                  id="agent-work-item"
                  value={workItemId}
                  onChange={event => setWorkItemId(event.target.value)}
                  disabled={readyItems.length === 0}
                  className={control}
                >
                  <option value="">Elige una tarea lista</option>
                  {readyItems.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.key} · {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="agent-profile" className="mb-1 block text-xs text-fg-muted">
                  Perfil de agente
                </label>
                <select
                  id="agent-profile"
                  value={profileId}
                  onChange={event => setProfileId(event.target.value)}
                  disabled={developerProfiles.length === 0}
                  className={control}
                >
                  <option value="">Elige un perfil</option>
                  {developerProfiles.map(profile => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.providerName}
                    </option>
                  ))}
                </select>
              </div>
              {availableModels.length > 0 && (
                <div>
                  <label htmlFor="agent-model" className="mb-1 block text-xs text-fg-muted">
                    Modelo
                  </label>
                  <select
                    id="agent-model"
                    value={model}
                    onChange={event => setModel(event.target.value)}
                    className={control}
                  >
                    {availableModels.map(option => (
                      <option key={option} value={option}>
                        {option}
                        {option === selectedProfile?.defaultModel ? ' (predeterminado)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    Los modelos más capaces consumen antes el límite de tu suscripción.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => void start()}
                disabled={!workItemId || !profileId || starting || loading}
                className={`min-h-10 w-full text-sm ${primary}`}
              >
                {starting
                  ? 'Preparando contexto…'
                  : `Iniciar ejecución${selectedProfile ? ` · ${selectedProfile.providerName}` : ''}`}
              </button>
              <p className="text-[11px] leading-relaxed text-fg-subtle">
                Cada ejecución trabaja en una copia aislada del repositorio (rama propia). Al terminar se auditan los
                cambios: lo que la política no permite se revierte. La política está en{' '}
                <button
                  type="button"
                  onClick={() => setTab('settings')}
                  className={`text-accent underline underline-offset-2 ${focusRing}`}
                >
                  Ajustes
                </button>
                .
              </p>
            </div>
            <div className="flex min-h-[320px] min-w-0 flex-col rounded-xl border border-border bg-surface-sunken">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                <div>
                  <h3 className="text-sm font-semibold text-fg">Actividad en vivo</h3>
                  <p role="status" aria-live="polite" className="mt-0.5 text-[11px] text-fg-muted">
                    {selectedExecution ? describeRun(selectedExecution) : 'Sin ejecución seleccionada'}
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {history}
                  {selectedExecution && ACTIVE.includes(selectedExecution.status) && (
                    <button
                      type="button"
                      onClick={() => void cancel()}
                      className={`min-h-9 shrink-0 text-xs ${danger}`}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
              {selectedExecution && (
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[11px] text-fg-muted sm:grid-cols-2">
                  <div className="flex gap-1">
                    <dt>Contexto:</dt>
                    <dd className="text-fg">{selectedExecution.contextSnapshotId ? 'preparado' : 'preparándose'}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Parte del commit</dt>
                    <dd className="font-mono text-fg">{selectedExecution.initialCommit.slice(0, 8)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Modelo:</dt>
                    <dd className="font-mono text-fg">{selectedExecution.modelUsed ?? 'predeterminado del motor'}</dd>
                  </div>
                  {latestRateLimit && (
                    <div className="flex gap-1">
                      <dt>Límite de uso:</dt>
                      <dd className="text-fg">{describeRateLimit(latestRateLimit)}</dd>
                    </div>
                  )}
                </dl>
              )}
              <ol aria-label="Eventos de ejecución" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {events.map(record => (
                  <li key={record.id} className="rounded-lg border border-border bg-surface-raised p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-accent">{eventLabel(record.event.type)}</span>
                      <span className="text-[11px] text-fg-subtle">
                        #{record.sequenceNo} · {new Date(record.createdAt).toLocaleTimeString('es')}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg">
                      {describeEvent(record.event)}
                    </p>
                  </li>
                ))}
              </ol>
              {!events.length && (
                <p className="m-auto px-4 py-10 text-center text-xs text-fg-muted">
                  {loading
                    ? 'Cargando ejecuciones…'
                    : 'Inicia una tarea lista para ver aquí los mensajes y herramientas del agente.'}
                </p>
              )}
              {selectedExecution?.status === 'COMPLETED' && (
                <div className="border-t border-border p-3 text-xs text-fg-muted">
                  La ejecución terminó.{' '}
                  <button
                    type="button"
                    onClick={() => setTab('review')}
                    className={`font-semibold text-accent underline underline-offset-2 ${focusRing}`}
                  >
                    Revisar el resultado
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {tab === 'review' && (
          <div className="space-y-3">
            {history}
            {selectedExecution?.pendingPackages?.length ? (
              <DependencyApproval key={selectedExecution.id} execution={selectedExecution} />
            ) : null}
            {selectedExecution?.status === 'COMPLETED' ? (
              <div className="rounded-xl border border-border bg-surface-sunken">
                <ExecutionReview
                  execution={selectedExecution}
                  tasks={coveredOf(selectedExecution).map(node => ({ id: node.id, key: node.key, label: node.label }))}
                  models={availableModels}
                  defaultModel={selectedProfile?.defaultModel ?? null}
                  onChanged={next => {
                    setSelectedExecutionId(next.id);
                    if (ACTIVE.includes(next.status)) setTab('run');
                    void window.workspaceIpc.queries.listExecutions(projectId).then(setExecutions).catch(setError);
                  }}
                />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border-strong p-4 text-xs text-fg-muted">
                {selectedExecution
                  ? `Esta ejecución está «${executionStatusLabel(selectedExecution.status)}». Solo se revisan las terminadas.`
                  : 'Elige una ejecución terminada para revisar sus cambios.'}
                {toReview > 0 ? ` Hay ${toReview} por revisar.` : ''}
              </p>
            )}
          </div>
        )}
        {tab === 'pilot' && <FeaturePilotPanel projectId={projectId} nodes={nodes} />}
        {tab === 'settings' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <ExecutionPolicyForm projectId={projectId} />
            <div className="space-y-4">
              <EngineAuthForm projectId={projectId} nodes={nodes} />
              <ProjectSkillsForm projectId={projectId} />
              {selectedProfile && (
                <Capabilities provider={selectedProfile.providerName} capabilities={selectedProfile.capabilities} />
              )}
            </div>
          </div>
        )}
      </div>
      {TABS.filter(item => item.id !== tab).map(item => (
        <div
          key={item.id}
          id={`agents-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`agents-tab-${item.id}`}
          hidden
        />
      ))}
      <dialog
        ref={dialogRef}
        className="approval-dialog w-[min(92vw,34rem)] rounded-2xl border border-border-strong bg-surface-raised p-0 text-fg shadow-2xl"
        aria-labelledby="approval-heading"
        onClose={handleApprovalClose}
      >
        {pendingApproval && (
          <div className="p-6">
            <h2 id="approval-heading" className="text-base font-semibold">
              Aprobación requerida
            </h2>
            <p className="mt-3 text-sm text-fg-muted">
              {String(pendingApproval.event.justification ?? 'El agente pide autorización para continuar.')}
            </p>
            <dl className="mt-4 space-y-2 rounded-lg border border-border bg-surface-sunken p-3 text-xs">
              <div>
                <dt className="text-fg-muted">Qué quiere hacer</dt>
                <dd className="mt-0.5 text-warning">
                  {actionLabel[String(pendingApproval.event.actionType ?? 'UNKNOWN')] ??
                    String(pendingApproval.event.actionType)}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Sobre</dt>
                <dd className="mt-0.5 break-all font-mono text-fg">{String(pendingApproval.event.target ?? '')}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-fg-muted">Si cierras este diálogo con Escape, la solicitud se rechaza.</p>
            <form method="dialog" className="mt-5 flex justify-end gap-3">
              <button type="submit" value="reject" autoFocus className={`min-h-10 px-4 text-sm ${danger}`}>
                Rechazar
              </button>
              <button type="submit" value="approve" className={`min-h-10 text-sm ${primary}`}>
                Aprobar una vez
              </button>
            </form>
          </div>
        )}
      </dialog>
    </section>
  );
}

function Capabilities({ provider, capabilities }: { provider: string; capabilities: AgentProfileDto['capabilities'] }) {
  const labels: [keyof AgentProfileDto['capabilities'], string][] = [
    ['supportsResume', 'Reanudar sesiones'],
    ['supportsStreaming', 'Actividad en vivo'],
    ['supportsApprovals', 'Pedir aprobación'],
    ['supportsCancellation', 'Cancelar'],
    ['supportsStructuredOutput', 'Respuesta estructurada'],
    ['supportsWorktrees', 'Copia aislada'],
  ];
  return (
    <section aria-labelledby="capabilities-heading" className="rounded-xl border border-border p-4">
      <h3 id="capabilities-heading" className="mb-3 text-xs font-semibold text-fg">
        Capacidades de {provider}
      </h3>
      <ul className="grid grid-cols-2 gap-2">
        {labels.map(([key, label]) => (
          <li key={key} className="flex items-center gap-2 text-xs text-fg-muted">
            <span aria-hidden="true" className={capabilities[key] ? 'text-success' : 'text-fg-subtle'}>
              {capabilities[key] ? '✓' : '—'}
            </span>
            {label}
            <span className="sr-only">: {capabilities[key] ? 'sí' : 'no'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
function describeEvent(event: AgentEventRecordDto['event']): string {
  switch (event.type) {
    case 'SESSION_INITIALIZED':
      return 'El agente empezó a trabajar.';
    case 'TEXT_DELTA':
      return String(event.delta ?? '');
    case 'TOOL_INVOCATION_STARTED': {
      const args = event.args as Record<string, unknown> | undefined;
      const target = [args?.command, args?.path, args?.pattern].find(value => typeof value === 'string' && value);
      return `${String(event.toolName ?? 'herramienta')}${target ? `: ${String(target)}` : ''}`;
    }
    case 'TOOL_INVOCATION_FINISHED':
      return `${event.isError ? 'Error · ' : ''}${String(event.resultPreview ?? '')}`;
    case 'FILE_TOUCHED':
      return `${String(event.operation ?? 'EDIT') === 'EDIT' ? 'Editó' : String(event.operation) === 'CREATE' ? 'Creó' : String(event.operation) === 'DELETE' ? 'Borró' : String(event.operation)} · ${String(event.relativePath ?? '')}`;
    case 'EXECUTION_FINISHED':
      return String(event.summary ?? 'Tarea terminada.');
    case 'EXECUTION_FAILED':
      return `${String(event.errorMessage ?? 'Falló la ejecución.')}${event.errorCode ? ` (${String(event.errorCode)})` : ''}`;
    case 'ACTION_DENIED':
      return `Acción denegada por la política · ${String(event.toolName ?? 'herramienta')}${event.target ? `: ${String(event.target)}` : ''}`;
    case 'RATE_LIMIT_UPDATED':
      return `Límite de uso · ${describeRateLimit(event)}`;
    default:
      return eventLabel(String(event.type));
  }
}
function describeRateLimit(event: AgentEventRecordDto['event']): string {
  const window =
    event.window === 'five_hour'
      ? 'ventana de 5 h'
      : event.window === 'seven_day'
        ? 'ventana semanal'
        : String(event.window ?? 'ventana');
  const used =
    typeof event.utilization === 'number' ? `${Math.round(event.utilization * 100)} % usado` : 'uso desconocido';
  const status =
    event.status === 'allowed' ? '' : event.status === 'rejected' ? ' · agotado' : ` · ${String(event.status)}`;
  return `${window}: ${used}${status}`;
}
