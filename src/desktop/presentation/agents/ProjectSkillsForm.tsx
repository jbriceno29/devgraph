import { useEffect, useState } from 'react';
import type { ProjectEnvironmentDto } from '../../../shared/contracts/agent-view.js';
import { errorText } from '../errors.js';
import { focusRing } from '../ui.js';

/** Plan S2/S4: the project's stack profile, approved packages, and whether interface tasks carry the bundled skills. */
export function ProjectSkillsForm({ projectId }: { projectId: string }) {
  const [environment, setEnvironment] = useState<ProjectEnvironmentDto | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const get = window.workspaceIpc.queries.getProjectEnvironment, set = window.workspaceIpc.commands.setProjectSkills;
  useEffect(() => {
    let current = true;
    if (get) void get(projectId).then(value => { if (current) setEnvironment(value); }).catch(reason => { if (current) setError(errorText(reason)); });
    return () => { current = false; };
  }, [projectId, get]);
  if (!get || !environment) return error ? <p role="alert" className="text-xs text-danger">{error}</p> : null;
  const toggle = async (enabled: boolean) => {
    if (!set) return;
    setBusy(true); setError(null);
    try { setEnvironment(await set(projectId, enabled)); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  return <section aria-label="Stack y skills" className="space-y-3 rounded-xl border border-border bg-surface p-4 text-xs text-fg">
    <h3 className="text-sm font-semibold">Stack y skills</h3>
    <p className="text-fg-muted">{environment.stackProfile ? <>Perfil <span className="font-medium text-fg">{environment.stackProfile.title}</span> (catálogo del {environment.stackProfile.reviewedAt}). {environment.installs ? 'La app instala sus paquetes en cada ejecución.' : 'Sin dependencias externas.'}</> : 'Este proyecto no sigue un perfil del catálogo (por ejemplo, porque ya tenía código).'}</p>
    {environment.approvedPackages.length > 0 && <p className="text-fg-muted">Paquetes aprobados además del perfil: <span className="font-mono text-[11px] text-fg">{environment.approvedPackages.join(', ')}</span></p>}
    {environment.bundledSkills.length > 0 && <label className={`flex min-h-9 items-start gap-2 rounded-lg ${focusRing}`}>
      <input type="checkbox" checked={environment.skillsEnabled} disabled={busy || !set} onChange={event => void toggle(event.target.checked)} className="mt-0.5" />
      <span><span className="font-medium">Skills de diseño en las tareas de interfaz</span> ({environment.bundledSkills.map(skill => `${skill.title}, ${skill.license}`).join('; ')}). <span className="text-fg-muted">Vienen con la app y no se descarga nada. En la medición multiplicaron por 3–4,5 el costo de cada tarea de interfaz; actívalas cuando el aspecto visual importe más que el costo.</span></span>
    </label>}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </section>;
}
