import { ErrorNotice } from '../errors.js';
import { control, focusRing, primary, secondary } from '../ui.js';
import { type ProjectDocsVm, useProjectDocs } from './use-project-docs.vm.js';

/**
 * Ajustes › Documentación en línea (plan C1): si los agentes pueden leer la documentación actual de lo que usan y de
 * qué dominios. Solo lectura: no pueden enviar nada ni entrar en otros sitios.
 */
export function ProjectDocsForm({ projectId }: { projectId: string }) {
  const vm = useProjectDocs(projectId);
  const { docs } = vm;
  if (!docs) return vm.error ? <ErrorNotice error={vm.error} /> : null;
  return (
    <section
      aria-label="Documentación en línea"
      className="space-y-3 rounded-xl border border-border bg-surface p-4 text-xs text-fg"
    >
      <h3 className="text-sm font-semibold">Documentación en línea</h3>
      <label className={`flex min-h-9 items-start gap-2 rounded-lg ${focusRing}`}>
        <input
          type="checkbox"
          checked={vm.enabled}
          disabled={vm.busy}
          onChange={event => vm.setEnabled(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Los agentes pueden leer documentación actual</span>{' '}
          <span className="text-fg-muted">
            antes de usar una API, en lugar de escribirla de memoria. Solo leen páginas de los dominios de abajo.
          </span>
        </span>
      </label>
      {vm.enabled && <DomainFields vm={vm} />}
      {vm.dirty && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={vm.busy} onClick={() => void vm.save()} className={`min-h-9 ${primary}`}>
            Guardar la documentación
          </button>
          <button type="button" disabled={vm.busy} onClick={vm.cancel} className={`min-h-9 ${secondary}`}>
            Cancelar
          </button>
        </div>
      )}
      <ErrorNotice error={vm.error} />
    </section>
  );
}

function DomainFields({ vm }: { vm: ProjectDocsVm }) {
  const docs = vm.docs!;
  return (
    <>
      <p className="text-fg-muted">
        Según el stack del proyecto:{' '}
        <span className="font-mono text-[11px] text-fg">{docs.stackDomains.join(', ')}</span>
      </p>
      <label className="block space-y-1">
        <span className="font-medium">Otros dominios (uno por línea)</span>
        <textarea
          className={`${control} min-h-16 font-mono`}
          value={vm.extraText}
          placeholder="orm.drizzle.team"
          onChange={event => vm.setExtraText(event.target.value)}
        />
      </label>
    </>
  );
}
