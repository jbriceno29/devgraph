import { ErrorNotice } from '../errors.js';
import { control, primary, secondary } from '../ui.js';
import { type RepositoryGitVm, useRepositoryGit } from './use-repository-git.vm.js';

/**
 * Ajustes › Repositorio y ramas (plan GIT): la rama base del proyecto, lo que tiene abierto el usuario y por qué la app
 * no puede guardar documentos ahora, si es el caso.
 */
export function RepositoryGitForm({ projectId }: { projectId: string }) {
  const vm = useRepositoryGit(projectId);
  const { status } = vm;
  if (!status) return vm.error ? <ErrorNotice error={vm.error} /> : null;
  return (
    <section
      aria-label="Repositorio y ramas"
      className="space-y-3 rounded-xl border border-border bg-surface p-4 text-xs text-fg"
    >
      <h3 className="text-sm font-semibold">Repositorio y ramas</h3>
      <BaseBranchField vm={vm} />
      <p className="text-fg-muted">
        Tienes abierta <span className="font-mono text-fg">{status.checkedOut ?? 'una versión sin rama'}</span>.
      </p>
      {status.documentsBlocked && (
        <p role="alert" className="rounded-lg border border-warning/50 bg-warning-soft p-2.5">
          No se pueden guardar documentos ahora. {status.documentsBlocked}
        </p>
      )}
      {!status.hasIdentity && (
        <p className="rounded-lg border border-border-strong p-2.5 text-fg-muted">
          Tu repositorio no tiene identidad de Git, así que los commits de la app irán firmados por «Graph Workspace».
          Para firmarlos tú: <code className="font-mono">git config user.name "Tu nombre"</code> y{' '}
          <code className="font-mono">git config user.email tu@correo</code>.
        </p>
      )}
      <p className="text-fg-muted">
        Las ramas <code className="font-mono">graphdev/…</code> son de la app. Puedes mirarlas, pero no las abras ni las
        borres: mientras una esté abierta, la app no puede actualizarla.
      </p>
      <button type="button" onClick={() => void vm.reload()} className={`min-h-9 ${secondary}`}>
        Volver a comprobar
      </button>
      <ErrorNotice error={vm.error} />
    </section>
  );
}

function BaseBranchField({ vm }: { vm: RepositoryGitVm }) {
  const status = vm.status!;
  return (
    <>
      <label className="block space-y-1">
        <span className="font-medium">Rama base</span>
        <select className={control} value={vm.draft} onChange={event => vm.setDraft(event.target.value)}>
          {status.branches
            .filter(branch => !branch.startsWith('graphdev/'))
            .map(branch => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
        </select>
        <span className="block text-fg-muted">
          Las features salen de esta rama y se integran en ella, y los documentos del proyecto se guardan en ella. La
          app nunca usa la rama que tengas abierta.
        </span>
      </label>
      {vm.dirty && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void vm.save()}
            disabled={vm.busy}
            className={`min-h-9 flex-1 ${primary}`}
          >
            {vm.busy ? 'Guardando…' : `Usar ${vm.draft} como rama base`}
          </button>
          <button
            type="button"
            onClick={() => vm.setDraft(status.baseBranch)}
            disabled={vm.busy}
            className={`min-h-9 ${secondary}`}
          >
            Cancelar
          </button>
        </div>
      )}
    </>
  );
}
