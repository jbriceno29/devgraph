import type { InceptionFeatureDto, InceptionProposalDto } from '../../../shared/contracts/inception-view.js';

const joinNames = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;

/** «Empieza cuando termine Fundación» a partir de los tempId de DEPENDS_ON. */
export function dependencyText(feature: InceptionFeatureDto, features: InceptionFeatureDto[]): string {
  const names = feature.dependsOn.map(id => features.find(item => item.tempId === id)?.title ?? id);
  if (names.length) return `Empieza cuando ${names.length === 1 ? 'termine' : 'terminen'} ${joinNames(names)}`;
  return feature.isFoundation ? 'Va primero: prepara la base del proyecto' : 'Puede empezar en cualquier momento';
}

/** Las features de la propuesta con sus tareas, en el orden en que se harán. */
export function PlanList({ plan, proposal }: { plan: InceptionFeatureDto[]; proposal: InceptionProposalDto }) {
  return (
    <ol className="space-y-3">
      {plan.map(feature => (
        <li key={feature.tempId} className="rounded-lg border border-border bg-surface-raised p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            {feature.title}
            {feature.isFoundation && !/fundaci[oó]n/i.test(feature.title) && (
              <span className="rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent">Fundación</span>
            )}
          </p>
          <p className="text-[11px] text-fg-subtle">{dependencyText(feature, plan)}</p>
          <ol className="mt-2 space-y-1 border-l border-border pl-3">
            {feature.tasks.map(task => {
              const first = task.title === proposal.scaffoldTaskTitle;
              return (
                <li key={task.tempId} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-fg">{task.title}</span>
                  {first && (
                    <span className="rounded bg-success-soft px-1.5 text-[11px] font-medium text-success">
                      Primera tarea
                    </span>
                  )}
                  <span className="text-[11px] text-fg-subtle">
                    {task.initialStatus === 'READY' ? 'lista para empezar' : 'espera a las anteriores'}
                  </span>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/** Plan REP, R3: lo que el mapa del código encontró ya hecho; entra al grafo al aprobar, sin tareas. */
export function ExistingCode({ existing }: { existing: NonNullable<InceptionProposalDto['existing']> }) {
  return (
    <>
      <p className="mb-2">
        Se leyó el código del repositorio. Esto entra al plan como hecho o a medias, con sus archivos, y se guarda en
        docs/MAPA_DEL_CODIGO.md.
      </p>
      <ul className="space-y-2">
        {existing.map(module => (
          <li key={module.module} className="rounded-lg border border-border bg-surface-raised p-3">
            <p className="text-sm font-medium text-fg">{module.module}</p>
            <ul className="mt-1 space-y-0.5">
              {module.capabilities.map(capability => (
                <li key={capability.title} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-fg">{capability.title}</span>
                  <span className="text-[11px] text-fg-subtle">
                    {capability.status === 'PARTIAL' ? 'a medias' : 'hecha'}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
