import { ErrorNotice } from '../errors.js';
import { focusRing, secondary } from '../ui.js';
import { checkDuration } from './execution-checks.logic.js';
import { useVerificationBaseline, type VerificationBaselineVm } from './use-verification-baseline.vm.js';

/**
 * Plan REP, R2: cómo están hoy las comprobaciones del repositorio, corridas una vez en una copia de la rama base. Si
 * algo ya falla, el plan empieza por arreglarlo y el piloto espera, salvo que el usuario acepte esos fallos.
 */
export function VerificationBaselinePanel({
  projectId,
  commands,
  autoRun = false,
}: {
  projectId: string;
  commands?: string[];
  autoRun?: boolean;
}) {
  const vm = useVerificationBaseline(projectId, { ...(commands ? { commands } : {}), ...(autoRun ? { autoRun } : {}) });
  const { baseline } = vm;
  if (!baseline) return <ErrorNotice error={vm.error} />;
  return (
    <section aria-label="Cómo está la verificación hoy" className="mt-3 space-y-2 text-xs">
      <p className="font-medium text-fg">Cómo está la verificación hoy</p>
      {baseline.status === 'NOT_RUN' && (
        <p className="text-fg-muted">Aún no se comprobó si las comprobaciones pasan en la rama base.</p>
      )}
      {baseline.status === 'RUNNING' && (
        <p role="status" className="text-fg-muted">
          Instalando y corriendo {baseline.commands.join(', ')} en una copia de la rama base… puede tardar un poco.
        </p>
      )}
      {baseline.status === 'DONE' && <BaselineResult vm={vm} />}
      {baseline.status !== 'RUNNING' && (
        <button type="button" onClick={() => void vm.run()} disabled={vm.busy} className={`min-h-8 px-3 ${secondary}`}>
          {baseline.status === 'NOT_RUN' ? 'Comprobar ahora' : 'Volver a comprobar'}
        </button>
      )}
      <ErrorNotice error={vm.error} />
    </section>
  );
}

function BaselineResult({ vm }: { vm: VerificationBaselineVm }) {
  const baseline = vm.baseline!;
  const failing = baseline.checks.filter(check => !check.passed);
  return (
    <>
      {vm.outdated && <p className="text-warning">Cambiaste las comprobaciones: vuelve a comprobarlas.</p>}
      {baseline.error && (
        <p role="alert" className="text-danger">
          {baseline.error}
        </p>
      )}
      <ul className="space-y-1">
        {baseline.checks.map(check => (
          <li key={check.command}>
            <span className={check.passed ? 'text-success' : 'text-danger'}>{check.passed ? 'Pasa' : 'Falla'}</span>{' '}
            <code className="font-mono text-[11px]">{check.summary}</code>
            {check.durationMs !== undefined && ` · ${checkDuration(check.durationMs)}`}
            {baseline.knownFailing.includes(check.command) && ' · aceptado como fallo conocido'}
            {!check.passed && (
              <details>
                <summary className={`cursor-pointer text-fg-muted ${focusRing}`}>Final de la salida</summary>
                <pre className="max-h-40 overflow-auto rounded bg-surface-sunken p-2 text-[11px]">{check.tail}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {failing.length > 0 && <FailureChoice vm={vm} />}
    </>
  );
}

function FailureChoice({ vm }: { vm: VerificationBaselineVm }) {
  const baseline = vm.baseline!;
  return baseline.blocking.length ? (
    <div role="alert" className="space-y-1.5 rounded-lg border border-warning/50 bg-warning-soft p-2.5">
      <p>
        Esto ya falla antes de que la app cambie nada. El plan empezará con la tarea «Dejar la verificación en verde» y
        el piloto no arrancará hasta que pase.
      </p>
      <button
        type="button"
        onClick={() => void vm.acceptKnown()}
        disabled={vm.busy}
        className={`min-h-8 px-3 ${secondary}`}
      >
        Aceptar estos fallos como conocidos
      </button>
    </div>
  ) : (
    <div className="space-y-1.5 text-fg-muted">
      <p>
        Aceptados como conocidos: quedan fuera de las comprobaciones hasta que «Dejar la verificación en verde» los
        arregle.
      </p>
      <button
        type="button"
        onClick={() => void vm.clearKnown()}
        disabled={vm.busy}
        className={`min-h-8 px-3 ${secondary}`}
      >
        Dejar de aceptarlos
      </button>
    </div>
  );
}
