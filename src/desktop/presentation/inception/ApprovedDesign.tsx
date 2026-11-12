import { useEffect, useState } from 'react';
import { type InceptionIpcClient, type InceptionViewDto } from '../../../shared/contracts/inception-view.js';
import { DESIGN_PROTOTYPE_PATH, UI_SPEC_PATH } from '../../../shared/ui-spec.js';
import { errorText } from '../errors.js';
import { focusRing } from '../ui.js';
import { PrototypeFrame } from './VisualExplorationStep.js';

/**
 * «Interfaz y experiencia acordadas»: what the approved direction becomes in the plan: the specification every feature will be documented by,
 * the screens and navigation agreed, and the prototype itself (loaded only when opened).
 */
export function ApprovedDesign({
  view,
  client,
  projectId,
}: {
  view: InceptionViewDto;
  client: InceptionIpcClient;
  projectId: string;
}) {
  const option = view.ui.options.find(item => item.id === view.ui.selectedOptionId);
  const [open, setOpen] = useState(false),
    [html, setHtml] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !option) return;
    let live = true;
    setError(null);
    void client
      .getUiPrototype(projectId, option.id)
      .then(value => {
        if (live) setHtml(value);
      })
      .catch(reason => {
        if (live) setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, [open, client, projectId, option?.id, view.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!option) return null;
  const hasSpec = view.proposal?.documents.some(document => document.relativePath === UI_SPEC_PATH) ?? false;
  const savesPrototype = option.source !== 'IMAGE';
  return (
    <section
      aria-label="Interfaz y experiencia acordadas"
      className="mb-4 rounded-lg border border-border bg-surface-sunken p-4"
    >
      <h3 className="text-sm font-semibold text-fg">
        Interfaz y experiencia acordadas{' '}
        <code className="font-mono text-[11px] font-normal text-fg-subtle">{UI_SPEC_PATH}</code>
      </h3>
      <p className="mt-1 text-xs leading-5 text-fg-muted">
        <span className="font-medium text-fg">Dirección aprobada: {option.title}.</span> {option.summary}{' '}
        {hasSpec
          ? `Al aprobar se crea ${UI_SPEC_PATH}, vinculado a cada feature`
          : `Falta ${UI_SPEC_PATH} en la propuesta: pide otra propuesta`}
        {hasSpec && savesPrototype
          ? `, y el prototipo se guarda en ${DESIGN_PROTOTYPE_PATH} para que cada agente lo consulte.`
          : hasSpec
            ? '.'
            : '.'}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {option.navigation && (
          <>
            <dt className="font-medium text-fg">Navegación</dt>
            <dd className="text-fg-muted">{option.navigation}</dd>
          </>
        )}
        {option.screens.length > 0 && (
          <>
            <dt className="font-medium text-fg">Pantallas</dt>
            <dd className="text-fg-muted">{option.screens.join(' · ')}</dd>
          </>
        )}
      </dl>
      <details className="mt-3" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className={`min-h-9 cursor-pointer rounded-lg py-2 text-sm font-medium text-accent ${focusRing}`}>
          Ver el prototipo aprobado
        </summary>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            No se pudo cargar el prototipo: {error}
          </p>
        ) : html === null ? (
          <p role="status" className="text-xs text-fg-muted">
            Cargando el prototipo…
          </p>
        ) : (
          <PrototypeFrame html={html} />
        )}
      </details>
    </section>
  );
}
