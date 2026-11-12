import { useState } from 'react';
import type { FeatureIntegrationResultDto } from '../../../shared/contracts/agent-view.js';
import { ErrorNotice } from '../errors.js';
import { primary, secondary } from '../ui.js';
import type { NextStep, NextStepAction, ShellTarget } from './next-step.js';

const tones = {
  neutral: 'border-accent/40 bg-accent-soft',
  attention: 'border-warning/50 bg-warning-soft',
  success: 'border-success/50 bg-success-soft',
};
const eyebrow = { neutral: 'text-accent', attention: 'text-warning', success: 'text-success' };
const button =
  'min-h-9 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const into = (branch: string | null) => (branch ? `en ${branch}` : 'en la rama principal');
const tasks = (count: number) => (count === 1 ? '1 tarea' : `${count} tareas`);

/**
 * Recomendación única con su botón primario («siguiente paso»). The button does exactly what it says: when the step
 * carries an action the banner runs it (with an inline confirmation); otherwise it navigates.
 */
export function NextStepBanner({
  step,
  onGo,
  onIntegrateFeature,
  onDone,
}: {
  step: NextStep;
  onGo(target: ShellTarget): void;
  onIntegrateFeature?: ((featureId: string) => Promise<FeatureIntegrationResultDto>) | undefined;
  onDone?(): void;
}) {
  const runnable = step.action?.kind === 'integrate-feature' && onIntegrateFeature ? step.action : null;
  return (
    <section
      aria-labelledby="next-step-title"
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border px-4 py-3 ${tones[step.tone]}`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${eyebrow[step.tone]}`}>Siguiente paso</p>
        <h2 id="next-step-title" className="mt-0.5 text-sm font-semibold text-fg">
          {step.title}
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">{step.detail}</p>
      </div>
      {runnable && onIntegrateFeature ? (
        <IntegrateAction
          key={step.id}
          action={runnable}
          run={onIntegrateFeature}
          onDone={onDone}
          label={step.actionLabel}
          onOpen={() => onGo(step.target)}
        />
      ) : (
        <button type="button" onClick={() => onGo(step.target)} className={button}>
          {step.action ? `Ver ${step.action.featureKey} para integrarla` : step.actionLabel}
        </button>
      )}
    </section>
  );
}

function IntegrateAction({
  action,
  run,
  onDone,
  label,
  onOpen,
}: {
  action: NextStepAction;
  /** After a failure: opens the feature, where its conflicts can be resolved. */
  onOpen(): void;
  run(featureId: string): Promise<FeatureIntegrationResultDto>;
  onDone?: (() => void) | undefined;
  label: string;
}) {
  const [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<FeatureIntegrationResultDto | null>(null),
    [error, setError] = useState<unknown>(null);
  const integrate = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await run(action.featureId));
      setConfirming(false);
      onDone?.();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <p role="status" className="text-sm font-medium text-success">
        {result.alreadyIntegrated
          ? `${action.featureKey} ya estaba integrada ${into(result.targetBranch)}.`
          : `${action.featureKey} integrada ${into(result.targetBranch)}${result.commit ? ` · commit ${result.commit.slice(0, 7)}` : ''}.`}
      </p>
    );
  if (!confirming)
    return (
      <button type="button" onClick={() => setConfirming(true)} className={button}>
        {label}
      </button>
    );
  return (
    <div className="w-full space-y-2 sm:w-auto">
      <p className="text-sm font-medium text-fg">
        ¿Juntar {tasks(action.doneTasks)} de {action.featureKey} {into(action.targetBranch)}?
      </p>
      <ConfirmButtons busy={busy} onConfirm={() => void integrate()} onCancel={() => setConfirming(false)} />
      <ErrorNotice error={error} />
      {error !== null && (
        <button type="button" onClick={onOpen} className={`min-h-9 px-4 text-sm ${secondary}`}>
          Ver {action.featureKey}
        </button>
      )}
    </div>
  );
}

function ConfirmButtons({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm(): void; onCancel(): void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onConfirm} disabled={busy} className={`min-h-9 px-4 text-sm ${primary}`}>
        {busy ? 'Integrando…' : 'Sí, integrar'}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className={`min-h-9 px-4 text-sm ${secondary}`}>
        Cancelar
      </button>
    </div>
  );
}
