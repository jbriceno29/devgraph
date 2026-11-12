import type { AgentExecutionDto } from '../../../shared/contracts/agent-view.js';
import { focusRing } from '../ui.js';
import { checkDuration } from './execution-checks.logic.js';

/** Revisión: cada comprobación de la ejecución con su resultado, y el log completo plegado debajo (plan C6). */
export function ExecutionChecks({ execution, log }: { execution: AgentExecutionDto; log: string | null }) {
  const checks = execution.checks ?? [];
  if (!checks.length && !log) return null;
  return (
    <section aria-label="Comprobaciones" className="space-y-1.5">
      {checks.length > 0 && (
        <ul className="space-y-1 text-xs">
          {checks.map(check => (
            <li key={check.command} className="flex flex-wrap items-baseline gap-x-2">
              <span className={check.passed ? 'text-success' : 'text-danger'}>
                {check.passed ? 'Pasó' : check.timedOut ? 'Tiempo agotado' : 'Falló'}
              </span>
              <code className="font-mono text-[11px] text-fg">{check.command}</code>
              {check.durationMs !== undefined && (
                <span className="text-fg-subtle">{checkDuration(check.durationMs)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {log && (
        <details className="rounded-lg border border-border bg-surface-raised">
          <summary className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs text-fg ${focusRing}`}>
            Log de verificación
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-border p-3 text-[11px] text-fg-muted">{log}</pre>
        </details>
      )}
    </section>
  );
}
