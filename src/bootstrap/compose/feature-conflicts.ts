import { CheckFeatureConflicts } from '../../modules/execution/application/check-feature-conflicts.js';
import { IntegrateFeature } from '../../modules/execution/application/integrate-feature.js';
import type {
  FeatureCatalogPort,
  FeatureTaskPort,
} from '../../modules/execution/application/ports/feature-conflict-port.js';
import { ResolveFeatureConflicts } from '../../modules/execution/application/resolve-feature-conflicts.js';
import { GitFeatureConflicts } from '../../modules/execution/infrastructure/git-feature-conflicts.js';
import type { Container } from '../container.js';

/** The conflict use cases of a project (plan UX, F0b): check before integrating, integrate, resolve with an agent. */
export function featureConflictServices(c: Container) {
  const git = new GitFeatureConflicts();
  const catalog = featureCatalog(c);
  const featureConflicts = {
    check: new CheckFeatureConflicts(git, catalog),
    integrate: new IntegrateFeature((id, featureId) => c.execution(id).integrateFeature(id, featureId), git, catalog),
    resolve: new ResolveFeatureConflicts(git, catalog, featureTasks(c), c.workspaceRoot),
  };
  return {
    featureConflicts,
    close: () => undefined,
  };
}

const featureCatalog = (c: Container): FeatureCatalogPort => ({
  repositoryRoot: projectId => c.repositoryPath(projectId),
  features: projectId =>
    c.store
      .openProject(projectId)
      .graph.listEntities(projectId)
      .filter(entity => entity.entityType === 'FEATURE' && entity.status !== 'ARCHIVED')
      .map(entity => ({ id: entity.id, displayKey: entity.displayKey, title: entity.title })),
  integration: (projectId, featureId) => c.execution(projectId).featureIntegration(projectId, featureId),
});

/** A task the user asked for with a button: a USER_BULK_ACTION ChangeSet applied at once, then marked READY. */
const featureTasks = (c: Container): FeatureTaskPort => ({
  create: async (projectId, featureId, task) => {
    const planning = c.planning(projectId);
    const changeSet = planning.submit(
      projectId,
      {
        title: task.title,
        rationale: 'Conflicto al integrar la feature en su rama base.',
        operations: [
          {
            type: 'CREATE_WORK_ITEM',
            tempId: '$conflict',
            parentId: featureId,
            workType: 'TASK',
            priority: 'HIGH',
            ...task,
          },
        ],
      },
      featureId,
      'USER_BULK_ACTION',
    );
    if (changeSet.status !== 'VALIDATED')
      throw new Error(changeSet.validationIssues.map(issue => issue.message).join(' ') || 'No se pudo crear la tarea.');
    const applied = await planning.apply(changeSet.id);
    c.emit('graph:revision_updated', { projectId, revision: applied.revision });
    const id = applied.resolvedIds.$conflict;
    if (!id) throw new Error('No se pudo crear la tarea que resuelve el conflicto.');
    c.execution(projectId).setWorkItemStatus(projectId, id, 'READY');
    return { id, displayKey: c.store.openProject(projectId).graph.findEntityById(id)?.displayKey ?? task.title };
  },
});
