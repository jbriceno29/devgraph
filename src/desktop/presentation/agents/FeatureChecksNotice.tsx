import { ErrorNotice } from '../errors.js';
import { primary, secondary } from '../ui.js';
import { checkDuration } from './execution-checks.logic.js';
import type { FeatureChecksVm } from './use-feature-checks.vm.js';

const headline: Record<string, string> = {
  NOT_RUN: 'Antes de integrar, la app comprueba que el resultado compila',
  RUNNING: 'Comprobando el resultado de integrar… puede tardar unos minutos',
  PASSED: 'Las comprobaciones de integración pasaron',
  FAILED: 'Las comprobaciones de integración fallaron',
  STALE: 'La feature o la rama base cambiaron desde la última comprobación',
};

/**
 * Plan C6: the checks that run once on the merge of the feature into its base (for example `next build`), in a copy:
 * nothing is integrated until they pass on the current branches.
 */
export function FeatureChecksNotice({ vm }: { vm: FeatureChecksVm }) {
  const { checks } = vm;
  if (!checks || checks.status === 'NONE') return <ErrorNotice error={vm.error} />;
  const canRun = checks.status !== 'RUNNING' && checks.status !== 'PASSED';
  return (
    <div role="status" className="space-y-1.5 rounded-lg border border-border-strong bg-surface p-2.5">
      <p className={`font-medium ${checks.status === 'FAILED' ? 'text-danger' : ''}`}>{headline[checks.status]}</p>
      <p className="text-fg-muted">
        Se ejecuta <span className="font-mono text-[11px] text-fg">{checks.commands.join(', ')}</span> sobre una copia
        con la feature ya junta; no se toca ninguna rama.
      </p>
      {checks.checks.length > 0 && checks.status !== 'RUNNING' && (
        <ul className="space-y-0.5">
          {checks.checks.map(check => (
            <li key={check.command}>
              <span className={check.passed ? 'text-success' : 'text-danger'}>
                {check.passed ? 'Pasó' : check.timedOut ? 'Tiempo agotado' : 'Falló'}
              </span>{' '}
              <code className="font-mono text-[11px]">{check.command}</code>
              {check.durationMs !== undefined && ` · ${checkDuration(check.durationMs)}`}
            </li>
          ))}
        </ul>
      )}
      {checks.status === 'FAILED' && checks.detail && (
        <pre className="max-h-40 overflow-auto rounded bg-surface-sunken p-2 text-[11px] text-fg-muted">
          {checks.detail}
        </pre>
      )}
      {canRun && (
        <button
          type="button"
          onClick={() => void vm.run()}
          disabled={vm.starting}
          className={`min-h-9 w-full text-xs ${checks.status === 'FAILED' ? secondary : primary}`}
        >
          {checks.status === 'NOT_RUN' ? 'Comprobar antes de integrar' : 'Volver a comprobar'}
        </button>
      )}
      <ErrorNotice error={vm.error} />
    </div>
  );
}
