import type { InceptionActivityDto } from '../../../shared/contracts/inception-view.js';
import { primary, focusRing } from '../ui.js';

const steps = [
  {
    title: 'Definir',
    text: 'Cuéntale al asistente qué quieres construir y responde unas pocas preguntas sobre objetivo y alcance.',
  },
  {
    title: 'Aprobar',
    text: 'Revisa la propuesta: visión, stack, reglas y plan inicial. No se crea nada hasta que la apruebes.',
  },
  { title: 'Ejecutar', text: 'Lanza la primera tarea con un agente y revisa el resultado antes de aceptarlo.' },
];

/** Guía de arranque para un proyecto sin features: lleva al asistente de inicio; Planificar queda como alternativa. */
export function EmptyProject({
  projectName,
  inception = null,
  onStart,
  onPlan,
}: {
  projectName: string;
  inception?: InceptionActivityDto | null;
  onStart(): void;
  onPlan(): void;
}) {
  return (
    <section aria-labelledby="empty-project-title" className="rounded-xl border border-border bg-surface-raised p-6">
      <h2 id="empty-project-title" className="text-base font-semibold text-fg">
        {projectName} aún no tiene features
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {inception ? inception.title : 'Tres pasos para pasar de una idea a tareas cerradas por agentes:'}
      </p>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-lg border border-border bg-surface-sunken p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-fg">
              <span
                aria-hidden="true"
                className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent"
              >
                {index + 1}
              </span>
              {step.title}
            </p>
            <p className="mt-2 text-xs leading-5 text-fg-muted">{step.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={onStart} className={`min-h-9 text-sm ${primary}`}>
          {inception ? 'Continuar el inicio' : 'Definir mi proyecto'}
        </button>
        <button
          type="button"
          onClick={onPlan}
          className={`min-h-9 rounded-lg px-2 text-sm text-accent underline-offset-2 hover:underline ${focusRing}`}
        >
          Prefiero describir el plan a mano
        </button>
      </div>
    </section>
  );
}
