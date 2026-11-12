import type { RepositorySurveyStateDto } from '../../../shared/contracts/repository-survey.js';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Plan REP, R3: how the reading of the code goes. It runs in the background while the user answers, and the proposal
 * waits for it; a failure does not block anything (the plan is made without the map).
 */
export function CodeMapStatus({ survey }: { survey: RepositorySurveyStateDto | null | undefined }) {
  if (!survey) return null;
  const map = survey.survey;
  const capabilities = map?.modules.reduce((total, module) => total + module.capabilities.length, 0) ?? 0;
  const partial =
    map?.modules.reduce(
      (total, module) => total + module.capabilities.filter(item => item.status === 'PARTIAL').length,
      0,
    ) ?? 0;
  return (
    <section aria-label="Mapa del código" className="rounded-lg border border-border bg-surface-raised p-3 text-xs">
      <p className="font-medium text-fg">Mapa de lo que ya existe</p>
      {survey.status === 'RUNNING' && (
        <p role="status" className="mt-1 text-fg-muted">
          Leyendo el código en una copia de la rama base, sin ejecutar nada. Puedes responder mientras tanto: la
          propuesta lo esperará.
        </p>
      )}
      {survey.status === 'DONE' && map && (
        <p role="status" className="mt-1 text-fg-muted">
          {map.modules.length
            ? `Listo: ${plural(map.modules.length, 'módulo', 'módulos')} y ${plural(capabilities, 'capacidad', 'capacidades')}${partial ? ` (${partial} a medias)` : ''}, cada una con sus archivos. La propuesta solo añadirá trabajo nuevo.`
            : 'No se encontró nada con evidencia suficiente: la propuesta se hará sin mapa.'}
        </p>
      )}
      {survey.status === 'FAILED' && (
        <p role="alert" className="mt-1 text-danger">
          No se pudo leer el código: {survey.error} La propuesta se hará sin mapa.
        </p>
      )}
    </section>
  );
}
