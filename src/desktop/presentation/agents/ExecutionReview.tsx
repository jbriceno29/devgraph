import { useEffect, useState } from 'react';
import { useResetOnChange } from '../use-reset-on-change.js';
import type { AgentExecutionDto, ExecutionDetailDto } from '../../../shared/contracts/agent-view.js';
import { fileChangeLabel } from '../labels.js';
import { errorText } from '../errors.js';
import { control, focusRing, primary, secondary } from '../ui.js';

const reviewLabel: Record<string, string> = {
  ACCEPTED: 'Aceptada e integrada',
  CHANGES_REQUESTED: 'Se pidieron ajustes',
  MERGE_CONFLICT: 'Conflicto al integrar',
};

/** Review of a completed run: what changed, how it was verified, and accept / request changes. */
export function ExecutionReview({
  execution,
  tasks = [],
  models,
  defaultModel,
  onChanged,
}: {
  execution: AgentExecutionDto;
  /** The tasks the execution covers (several in a grouped run), for the heading. */
  tasks?: Array<{ id: string; key: string; label: string }>;
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
    void window.workspaceIpc.queries
      .getExecutionDetail(execution.id)
      .then(result => {
        if (current) setDetail(result);
      })
      .catch(reason => {
        if (current) setMessage({ tone: 'error', text: errorText(reason) });
      });
    return () => {
      current = false;
    };
  }, [execution.id, execution.status, execution.reviewStatus]);
  useResetOnChange(defaultModel, () => setModel(defaultModel ?? ''));

  const accept = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.workspaceIpc.commands.acceptExecution(execution.id);
      setMessage(
        result.merged
          ? {
              tone: 'ok',
              text: `Integrada en ${result.execution.baseBranch} (commit ${result.execution.mergedCommit?.slice(0, 8)}). La tarea quedó como Hecha.`,
            }
          : {
              tone: 'error',
              text: [result.conflict?.detail, ...(result.conflict?.files ?? []).map(file => `· ${file}`)]
                .filter(Boolean)
                .join('\n'),
            },
      );
      onChanged(result.execution);
    } catch (reason) {
      setMessage({ tone: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  const requestChanges = async () => {
    if (!feedback.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await window.workspaceIpc.commands.requestExecutionChanges({
        executionId: execution.id,
        feedback: feedback.trim(),
        ...(model ? { model } : {}),
      });
      setFeedback('');
      onChanged(next);
    } catch (reason) {
      setMessage({ tone: 'error', text: errorText(reason) });
    } finally {
      setBusy(false);
    }
  };

  if (!detail)
    return message ? (
      <p role="alert" className="m-4 text-xs text-danger">
        {message.text}
      </p>
    ) : null;
  const status = execution.reviewStatus
    ? reviewLabel[execution.reviewStatus]
    : detail.canAccept
      ? 'Pendiente de revisión'
      : 'Sin revisión';

  return (
    <section aria-label="Revisión de la ejecución" className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Revisión</h3>
        <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
          {status}
        </span>
      </div>
      {execution.coveredWorkItemIds.length > 1 && (
        <p className="rounded-lg border border-pilot-border/60 bg-pilot-soft p-2 text-xs text-fg">
          <span className="font-semibold text-pilot">Ejecución agrupada:</span> cierra{' '}
          {execution.coveredWorkItemIds.length} tareas a la vez (
          {execution.coveredWorkItemIds
            .map(id => {
              const task = tasks.find(item => item.id === id);
              return task ? `${task.key} «${task.label}»` : id;
            })
            .join(', ')}
          ). Aceptar las integra todas con un solo commit; pedir ajustes relanza el grupo entero.
        </p>
      )}
      {execution.resultSummary && <p className="text-xs leading-relaxed text-fg">{execution.resultSummary}</p>}
      {!!execution.qualityFlags?.length && (
        <div role="alert" className="rounded-lg border border-warning/50 bg-warning-soft p-2 text-xs text-fg">
          <p className="font-semibold">Revisa la verificación antes de aceptar</p>
          <p className="text-fg-muted">
            Las comprobaciones pasaron, pero esta ejecución tocó lo que decide qué se comprueba. Por eso no se aceptó
            sola.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {execution.qualityFlags.map(flag => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-fg-muted">
        Se integrará en la rama <span className="font-mono text-fg">{execution.baseBranch ?? '—'}</span>
        {execution.mergedCommit && (
          <>
            {' '}
            · commit integrado <span className="font-mono text-fg">{execution.mergedCommit.slice(0, 8)}</span>
          </>
        )}
      </p>
      {execution.reviewStatus === 'CHANGES_REQUESTED' && execution.reviewNote && (
        <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-fg-muted">
          Ajustes pedidos: {execution.reviewNote}
        </p>
      )}

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Archivos ({detail.files.length})
        </h4>
        {detail.files.length === 0 ? (
          <p className="text-xs text-fg-muted">La ejecución no cambió archivos.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.files.map(file => (
              <li key={file.path}>
                <details className="rounded-lg border border-border bg-surface-raised">
                  <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs text-fg ${focusRing}`}>
                    <span className="mr-2 text-[11px] text-accent">{fileChangeLabel(file.changeType)}</span>
                    <span className="font-mono">{file.path}</span>{' '}
                    <span className="text-success">+{file.additions}</span>{' '}
                    <span className="text-danger">−{file.deletions}</span>
                  </summary>
                  <pre className="max-h-80 overflow-auto border-t border-border p-3 text-[11px] leading-relaxed text-fg-muted">
                    {file.patch ?? 'Contenido omitido (ruta prohibida por la política).'}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail.deniedActions.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-warning">
            Acciones denegadas ({detail.deniedActions.length})
          </h4>
          <ul className="space-y-1 text-xs text-fg-muted">
            {detail.deniedActions.map((action, index) => (
              <li key={index}>
                <span className="font-semibold text-fg">{action.toolName}</span>
                {action.target ? `: ${action.target}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.testLog && (
        <details className="rounded-lg border border-border bg-surface-raised">
          <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs text-fg ${focusRing}`}>
            Log de verificación
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-border p-3 text-[11px] text-fg-muted">
            {detail.testLog}
          </pre>
        </details>
      )}

      {detail.canAccept && (
        <button
          type="button"
          onClick={() => void accept()}
          disabled={busy}
          className={`min-h-10 w-full text-sm ${primary}`}
        >{`Aceptar e integrar en ${execution.baseBranch ?? 'la rama de la feature'}`}</button>
      )}

      {detail.canRequestChanges && (
        <div className="space-y-2">
          <label htmlFor={`feedback-${execution.id}`} className="block text-xs text-fg-muted">
            ¿Qué hay que ajustar?
          </label>
          <textarea
            id={`feedback-${execution.id}`}
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
            rows={3}
            className={`${control} resize-y py-2`}
            placeholder="Ej. Falta validar títulos de más de 200 caracteres."
          />
          {models.length > 0 && (
            <div>
              <label htmlFor={`review-model-${execution.id}`} className="mb-1 block text-xs text-fg-muted">
                Modelo para los ajustes
              </label>
              <select
                id={`review-model-${execution.id}`}
                value={model}
                onChange={event => setModel(event.target.value)}
                className={control}
              >
                {models.map(option => (
                  <option key={option} value={option}>
                    {option}
                    {option === defaultModel ? ' (predeterminado)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => void requestChanges()}
            disabled={busy || !feedback.trim()}
            className={`min-h-10 w-full text-sm ${secondary}`}
          >
            Pedir ajustes
          </button>
        </div>
      )}

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`whitespace-pre-wrap rounded-lg border p-3 text-xs ${message.tone === 'error' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-success/40 bg-success-soft text-success'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
