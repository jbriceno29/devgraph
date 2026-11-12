import type { EntityInspectorDto } from '../../../shared/contracts/ipc-contracts.js';
import type { ContextPackageDto } from '../../../shared/contracts/context-view.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { useState, type ReactNode } from 'react';
import { ContextPills } from '../planning/ContextPills.js';
import {
  capitalize,
  edgeLabel,
  entityLabel,
  executionStatusLabel,
  fileChangeLabel,
  inverseEdgeLabel,
  provenanceLabel,
  shortDate,
  statusLabel,
} from '../labels.js';
import { errorText } from '../errors.js';
import { FeatureIntegration } from '../agents/FeatureIntegration.js';
import type { FeatureIntegrationResultDto } from '../../../shared/contracts/agent-view.js';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const shell =
  'flex w-[clamp(15rem,32vw,20.625rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised';
const heading = 'text-[11px] font-semibold uppercase tracking-wider text-fg-muted';
/** Nombres legibles de los atributos que más se repiten; el resto se humaniza (snake/camel → palabras). */
const attributeNames: Record<string, string> = {
  scope: 'Alcance',
  description: 'Descripción',
  acceptance_criteria: 'Criterios de aceptación',
  acceptanceCriteria: 'Criterios de aceptación',
  priority: 'Prioridad',
  estimate: 'Estimación',
  owner: 'Responsable',
  relative_path: 'Archivo',
  relativePath: 'Archivo',
  artifact_type: 'Tipo de documento',
  artifactType: 'Tipo de documento',
  adr_number: 'Número de ADR',
  version: 'Versión',
  context: 'Contexto',
  decision: 'Decisión',
  consequences: 'Consecuencias',
  rationale: 'Motivo',
  path: 'Ruta',
  language: 'Lenguaje',
  due_date: 'Fecha límite',
  dueDate: 'Fecha límite',
  created_at: 'Creado',
  createdAt: 'Creado',
  updated_at: 'Actualizado',
  updatedAt: 'Actualizado',
};
const looksLikeId = (key: string, value: unknown) =>
  /(^id$|_id$|Id$|^entity|hash$|Hash$)/.test(key) ||
  (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
const attributeName = (key: string) =>
  attributeNames[key] ??
  capitalize(
    key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .toLowerCase(),
  );
const statusHelp: Record<string, string> = {
  IN_PROGRESS: 'Hay una ejecución en curso; el estado lo controla la ejecución.',
  IN_REVIEW: 'Revisa la ejecución en Agentes para aceptarla o pedir ajustes.',
};

/** Detalle del elemento elegido en el grafo: qué es, en qué estado está, qué hacer ahora y con qué se relaciona. */
export function ContextualInspector({
  details,
  contextPackage,
  contextLoading,
  contextError,
  onRefreshContext,
  onChangeStatus,
  onOpenAgents,
  nodes,
  onIntegrateFeature,
  onFeatureIntegrated,
}: {
  details: EntityInspectorDto | null;
  contextPackage: ContextPackageDto | null;
  contextLoading: boolean;
  contextError: string | null;
  onRefreshContext(maxTokens: number, query?: string): void;
  onChangeStatus?(status: string): Promise<void>;
  onOpenAgents?(workItemId: string, executionId?: string): void;
  nodes?: GraphNodeView[];
  onIntegrateFeature?(featureId: string): Promise<FeatureIntegrationResultDto>;
  onFeatureIntegrated?(result: FeatureIntegrationResultDto): void;
}) {
  if (!details)
    return (
      <aside aria-label="Inspector" className={`${shell} p-5`}>
        <h2 className="text-sm font-semibold text-fg">Inspector</h2>
        <p className="mt-4 text-sm text-fg-muted">Selecciona un elemento del grafo para ver su detalle.</p>
      </aside>
    );
  const { entity, attributes, relationships, executionHistory } = details;
  const parent = entity.parentId
    ? (nodes?.find(node => node.id === entity.parentId)?.label ??
      relationships.find(edge => edge.sourceId === entity.parentId)?.sourceLabel ??
      relationships.find(edge => edge.targetId === entity.parentId)?.targetLabel)
    : undefined;
  const properties = Object.entries(attributes).filter(
    ([key, value]) => !looksLikeId(key, value) && value !== null && value !== undefined && value !== '',
  );
  const runs = [...executionHistory].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return (
    <aside aria-label="Inspector" className={shell}>
      <header className="border-b border-border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-md border border-border-strong bg-surface-sunken px-2 py-0.5 font-mono text-[11px] text-fg-muted">
            {entity.key}
          </span>
          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {statusLabel(entity.status)}
          </span>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{entityLabel(entity.type)}</p>
        <h2 className="mt-1 text-base font-semibold leading-snug text-fg">{entity.label}</h2>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{entity.summary || 'Sin resumen registrado.'}</p>
        {entity.type === 'WORK_ITEM' && onOpenAgents && (
          <TaskAction
            status={entity.status}
            onRun={() => onOpenAgents(entity.id)}
            onOpen={() => onOpenAgents(entity.id, runs[0]?.id)}
          />
        )}
        {entity.type === 'FEATURE' && (
          <FeatureIntegration
            className="mt-3"
            featureKey={entity.key}
            state={details.integration}
            onIntegrate={onIntegrateFeature ? () => onIntegrateFeature(entity.id) : undefined}
            {...(onFeatureIntegrated ? { onDone: onFeatureIntegrated } : {})}
          />
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {onChangeStatus && details.allowedStatusChanges && entity.type === 'DECISION_RECORD' && (
          <DecisionControl
            key={entity.id + entity.status}
            current={entity.status}
            options={details.allowedStatusChanges}
            onChange={onChangeStatus}
          />
        )}
        {onChangeStatus && details.allowedStatusChanges && entity.type !== 'DECISION_RECORD' && (
          <StatusControl
            key={entity.id + entity.status}
            current={entity.status}
            options={details.allowedStatusChanges}
            onChange={onChangeStatus}
          />
        )}
        {details.outcome && <OutcomeSection outcome={details.outcome} />}
        {(parent || properties.length > 0) && (
          <section>
            <h3 className={`mb-2 ${heading}`}>Propiedades</h3>
            <dl className="space-y-2">
              {parent && <Property name="Pertenece a" value={parent} />}
              {properties.map(([key, value]) => (
                <Property key={key} name={attributeName(key)} value={<Value value={value} />} />
              ))}
            </dl>
          </section>
        )}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className={heading}>Relaciones</h3>
            <span className="text-[11px] text-fg-subtle">{relationships.length}</span>
          </div>
          {relationships.length === 0 ? (
            <p className="text-xs text-fg-muted">Sin relaciones con otros elementos.</p>
          ) : (
            <ul className="space-y-2">
              {relationships.map(edge => (
                <li key={edge.id} className="rounded-lg border border-border bg-surface-sunken p-2.5">
                  <p className="text-[11px] font-semibold text-accent">
                    {capitalize(edge.direction === 'INCOMING' ? inverseEdgeLabel(edge.type) : edgeLabel(edge.type))}
                  </p>
                  <p className="mt-0.5 text-xs text-fg">
                    {edge.direction === 'INCOMING' ? edge.sourceLabel : edge.targetLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] text-fg-subtle">Relación {provenanceLabel(edge.provenance)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className={heading}>Historial de ejecuciones</h3>
            <span className="text-[11px] text-fg-subtle">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <p className="text-xs text-fg-muted">Esta tarea aún no se ha ejecutado.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map(run => (
                <li key={run.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-fg">{executionStatusLabel(run.status)}</span>
                    <span className="text-[11px] text-fg-subtle">{shortDate(run.completedAt ?? run.startedAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{run.resultSummary ?? 'Sin resumen.'}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        {['FEATURE', 'WORK_ITEM'].includes(entity.type) && (
          <ContextPills
            context={contextPackage}
            loading={contextLoading}
            error={contextError}
            onRefresh={onRefreshContext}
          />
        )}
      </div>
    </aside>
  );
}
/** Acción principal según el estado de la tarea: ejecutarla, ver su progreso o revisar su resultado. */
function TaskAction({ status, onRun, onOpen }: { status: string; onRun(): void; onOpen(): void }) {
  if (status === 'READY')
    return (
      <button
        type="button"
        onClick={onRun}
        className={`mt-3 min-h-9 w-full rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90 ${focusRing}`}
      >
        Ejecutar esta tarea
      </button>
    );
  if (status === 'IN_REVIEW')
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`mt-3 min-h-9 w-full rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90 ${focusRing}`}
      >
        Revisar resultado
      </button>
    );
  if (status === 'IN_PROGRESS')
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`mt-3 min-h-9 w-full rounded-lg border border-accent/60 px-3 text-xs font-semibold text-accent hover:bg-accent-soft ${focusRing}`}
      >
        Ver progreso
      </button>
    );
  return null;
}
function Property({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className="border-b border-border pb-2">
      <dt className="text-[11px] text-fg-subtle">{name}</dt>
      <dd className="mt-0.5 break-words text-xs text-fg">{value}</dd>
    </div>
  );
}
/** Muestra listas como viñetas y objetos como «clave: valor», nunca JSON crudo. */
function Value({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value))
    return value.length ? (
      <ul className="list-disc space-y-0.5 pl-4">
        {value.map((item, index) => (
          <li key={index}>{plain(item)}</li>
        ))}
      </ul>
    ) : (
      '—'
    );
  if (value && typeof value === 'object')
    return (
      <ul className="space-y-0.5">
        {Object.entries(value)
          .filter(([key, item]) => !looksLikeId(key, item))
          .map(([key, item]) => (
            <li key={key}>
              <span className="text-fg-muted">{attributeName(key)}:</span> {plain(item)}
            </li>
          ))}
      </ul>
    );
  return plain(value);
}
function plain(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.map(plain).join(', ');
  if (typeof value === 'object')
    return Object.entries(value)
      .filter(([key, item]) => !looksLikeId(key, item))
      .map(([key, item]) => `${attributeName(key)}: ${plain(item)}`)
      .join(' · ');
  return String(value);
}
/** Cambio manual de estado de una tarea; solo se ofrecen las transiciones que el núcleo permite. */
function StatusControl({
  current,
  options,
  onChange,
}: {
  current: string;
  options: string[];
  onChange(status: string): Promise<void>;
}) {
  const [target, setTarget] = useState(options[0] ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const apply = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(target);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Estado de la tarea" className="rounded-xl border border-border bg-surface-sunken p-3">
      <h3 className={`mb-2 ${heading}`}>Estado</h3>
      {options.length === 0 ? (
        <p className="text-xs text-fg-muted">{statusHelp[current] ?? 'Este estado no admite cambios manuales.'}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <label htmlFor="work-item-status" className="sr-only">
            Nuevo estado
          </label>
          <select
            id="work-item-status"
            value={target}
            onChange={event => setTarget(event.target.value)}
            className={`min-h-9 min-w-[8rem] flex-1 rounded-lg border border-border-strong bg-surface-raised px-2 text-xs text-fg ${focusRing}`}
          >
            {options.map(option => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy}
            className={`min-h-9 flex-1 rounded-lg border border-border-strong px-3 text-xs text-fg hover:border-accent disabled:opacity-50 ${focusRing}`}
          >
            Cambiar estado
          </button>
        </div>
      )}
      {current === 'IN_REVIEW' && options.length > 0 && (
        <p className="mt-2 text-[11px] text-fg-muted">{statusHelp.IN_REVIEW}</p>
      )}
      {current === 'DRAFT' && options.includes('READY') && (
        <p className="mt-2 text-[11px] text-fg-muted">Márcala como «Lista» para poder ejecutarla con un agente.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
const decisionActions: Record<string, { label: string; primary?: boolean }> = {
  ACCEPTED: { label: 'Aceptar', primary: true },
  REJECTED: { label: 'Rechazar' },
  SUPERSEDED: { label: 'Marcar como reemplazada' },
  DRAFT: { label: 'Volver a borrador' },
};
const decisionHelp: Record<string, string> = {
  DRAFT: 'Los agentes aún no la reciben: solo siguen las decisiones aceptadas.',
  ACCEPTED: 'Los agentes la reciben en el contexto de las tareas a las que afecta.',
  REJECTED: 'Descartada: los agentes no la reciben.',
  SUPERSEDED: 'Reemplazada por otra decisión: los agentes ya no la siguen. Reábrela si fue un error.',
};
/** Decisión (ADR): aceptarla, rechazarla, marcarla como reemplazada o reabrirla. */
function DecisionControl({
  current,
  options,
  onChange,
}: {
  current: string;
  options: string[];
  onChange(status: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  // Leaving ACCEPTED changes what the agents follow: it asks first (a second click on «Aceptar» used to land here).
  const choose = (status: string) => (current === 'ACCEPTED' ? setConfirming(status) : void apply(status));
  const apply = async (status: string) => {
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      await onChange(status);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Estado de la decisión" className="rounded-xl border border-border bg-surface-sunken p-3">
      <h3 className={`mb-1 ${heading}`}>Decisión</h3>
      <p className="mb-2 text-[11px] text-fg-muted">{decisionHelp[current] ?? 'Este estado no admite cambios.'}</p>
      {confirming ? (
        <div role="group" aria-label="Confirmar cambio" className="space-y-2">
          <p className="text-xs text-fg">
            Los agentes dejarán de seguir esta decisión. ¿
            {decisionActions[confirming]?.label ?? statusLabel(confirming)}?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void apply(confirming)}
              className={`min-h-9 flex-1 rounded-lg border border-border-strong px-3 text-xs text-fg hover:border-accent ${focusRing}`}
            >
              Sí, {(decisionActions[confirming]?.label ?? statusLabel(confirming)).toLowerCase()}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className={`min-h-9 flex-1 rounded-lg border border-border-strong px-3 text-xs text-fg hover:border-accent ${focusRing}`}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {options.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => choose(option)}
                disabled={busy}
                className={`min-h-9 flex-1 rounded-lg px-3 text-xs disabled:opacity-50 ${focusRing} ${
                  decisionActions[option]?.primary
                    ? 'bg-accent font-medium text-accent-fg hover:opacity-90'
                    : 'border border-border-strong text-fg hover:border-accent'
                }`}
              >
                {decisionActions[option]?.label ?? statusLabel(option)}
              </button>
            ))}
          </div>
        )
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
/** Lo que dejó la tarea al aceptarse: la memoria que reciben en su contexto las tareas siguientes. */
function OutcomeSection({ outcome }: { outcome: NonNullable<EntityInspectorDto['outcome']> }) {
  return (
    <section aria-label="Resultado al cerrar" className="rounded-xl border border-success/40 bg-success-soft p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-success">Resultado al cerrar</h3>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-fg">{outcome.summary}</p>
      {outcome.files.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {outcome.files.map(file => (
            <li key={file.path} className="text-[11px] text-fg-muted">
              <span className="text-fg-subtle">{fileChangeLabel(file.status)}</span> ·{' '}
              <span className="font-mono">{file.path}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-fg-muted">
        {outcome.integrationBranch ? `Integrada en ${outcome.integrationBranch}` : 'Integrada'}
        {outcome.mergedCommit ? ` · commit ${outcome.mergedCommit.slice(0, 8)}` : ''} ·{' '}
        {shortDate(outcome.createdAt) || outcome.createdAt.slice(0, 10)}
      </p>
    </section>
  );
}
