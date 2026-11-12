import { useState } from 'react';
import { ErrorNotice } from '../errors.js';
import { primary, secondary } from '../ui.js';
import type { FeatureConflictsVm } from './use-feature-conflicts.vm.js';

const files = (paths: string[]) => (
  <ul className="list-inside list-disc font-mono text-[11px] text-fg">
    {paths.map(path => (
      <li key={path}>{path}</li>
    ))}
  </ul>
);

/**
 * Conflictos de una feature terminada antes de integrarla: con su rama base (integrar fallaría; se ofrece «Resolver con
 * un agente»), marcadores sin resolver y choques con otras features sin integrar (solo aviso).
 */
export function FeatureConflictsNotice({ featureKey, vm }: { featureKey: string; vm: FeatureConflictsVm }) {
  const { conflicts, resolved } = vm;
  if (!conflicts) return null;
  const target = conflicts.targetBranch ?? 'la rama principal';
  return (
    <div className="space-y-2">
      {!resolved && <ConflictAlert featureKey={featureKey} target={target} vm={vm} />}
      {resolved && (
        <p role="status" className="font-medium text-success">
          Creé {resolved.workItemKey} «Resolver conflictos con {target}» en {featureKey}. Ejecútala o activa el piloto;
          cuando la aceptes podrás integrar.
        </p>
      )}
      {conflicts.withFeatures.map(other => (
        <div key={other.featureId} className="space-y-1 rounded-lg border border-border-strong p-2.5">
          <p className="font-medium">
            También choca con {other.featureKey} «{other.title}», que aún no está integrada:
          </p>
          {files(other.files)}
          <p className="text-fg-muted">La que se integre en segundo lugar tendrá que resolver el conflicto.</p>
        </div>
      ))}
    </div>
  );
}

function ConflictAlert({ featureKey, target, vm }: { featureKey: string; target: string; vm: FeatureConflictsVm }) {
  const conflicts = vm.conflicts!;
  const withTarget = conflicts.withTarget.length > 0;
  const colliding = withTarget ? conflicts.withTarget : conflicts.unresolved;
  if (!colliding.length) return null;
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-warning/50 bg-warning-soft p-2.5">
      <p className="font-semibold text-warning">
        {withTarget
          ? `${featureKey} choca con lo que ya está en ${target}`
          : `${featureKey} tiene conflictos sin resolver`}
      </p>
      <p className="text-fg-muted">
        {withTarget
          ? `Estos archivos cambiaron en ${target} y en ${featureKey} de forma distinta. Integrar ahora fallaría (${target} no se toca):`
          : 'Estos archivos aún tienen marcadores de conflicto, y la tarea que los resolvía ya no está pendiente:'}
      </p>
      {files(colliding)}
      <p className="text-fg-muted">
        «Resolver con un agente» junta {target} en {featureKey} y crea una tarea que resuelve el conflicto conservando
        lo ya integrado. La revisas y la aceptas como cualquier otra; después podrás integrar.
      </p>
      <ResolveButton vm={vm} />
      <ErrorNotice error={vm.error} />
    </div>
  );
}

function ResolveButton({ vm }: { vm: FeatureConflictsVm }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`min-h-9 w-full text-xs ${primary}`}>
        Resolver con un agente
      </button>
    );
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => void vm.resolve().then(() => setConfirming(false))}
        disabled={vm.resolving}
        className={`min-h-9 flex-1 text-xs ${primary}`}
      >
        {vm.resolving ? 'Creando la tarea…' : 'Sí, crear la tarea'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={vm.resolving}
        className={`min-h-9 flex-1 text-xs ${secondary}`}
      >
        Cancelar
      </button>
    </div>
  );
}
