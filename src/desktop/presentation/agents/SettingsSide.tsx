import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { EngineAuthForm } from './EngineAuthForm.js';
import { ProjectDocsForm } from './ProjectDocsForm.js';
import { ProjectSkillsForm } from './ProjectSkillsForm.js';
import { RepositoryGitForm } from './RepositoryGitForm.js';
import { VerificationBaselinePanel } from './VerificationBaselinePanel.js';

/** Columna lateral de Ajustes: motor, repositorio y ramas, stack y skills, documentación en línea, línea base de verificación. */
export function SettingsSide({ projectId, nodes }: { projectId: string; nodes: GraphNodeView[] }) {
  return (
    <>
      <EngineAuthForm projectId={projectId} nodes={nodes} />
      <RepositoryGitForm projectId={projectId} />
      <section className="rounded-xl border border-border bg-surface p-4">
        <VerificationBaselinePanel projectId={projectId} />
      </section>
      <ProjectSkillsForm projectId={projectId} />
      <ProjectDocsForm projectId={projectId} />
    </>
  );
}
