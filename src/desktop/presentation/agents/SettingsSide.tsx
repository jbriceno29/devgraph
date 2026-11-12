import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { EngineAuthForm } from './EngineAuthForm.js';
import { ProjectSkillsForm } from './ProjectSkillsForm.js';
import { RepositoryGitForm } from './RepositoryGitForm.js';

/** Columna lateral de Ajustes: motor, repositorio y ramas, stack y skills. */
export function SettingsSide({ projectId, nodes }: { projectId: string; nodes: GraphNodeView[] }) {
  return (
    <>
      <EngineAuthForm projectId={projectId} nodes={nodes} />
      <RepositoryGitForm projectId={projectId} />
      <ProjectSkillsForm projectId={projectId} />
    </>
  );
}
