import { GetEntityInspectorDetailsUseCase } from '../../modules/knowledge/application/get-entity-inspector-details.js';
import { GetGraphViewUseCase } from '../../modules/knowledge/application/get-graph-view.js';
import { decisionTransitions } from '../../modules/knowledge/domain/decision-status.js';
import { manualWorkItemTransitions, type WorkItemStatus } from '../../modules/knowledge/domain/work-items.js';
import { GitRepositoryInitializer } from '../../modules/projects/infrastructure/git-repository-initializer.js';
import { checkProjectLocation } from '../../modules/projects/infrastructure/project-location.js';
import { toProjectSummary } from '../../modules/projects/ipc.js';
import type { FeatureIntegrationStateDto } from '../../shared/contracts/agent-view.js';
import type { CreateProjectInput, WorkspaceLoadedStateDto } from '../../shared/contracts/ipc-contracts.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { Container } from '../container.js';
import { proposeFromChat } from './propose-from-chat.js';

/**
 * Flows that span several modules (open a project, the inspector, the context flow of a task…). They are composition,
 * not rules: each step calls a module. Moving them into use cases is part of A3.
 */
export function workspaceHandlers(c: Container): IpcHandlers {
  const connectRepository = async (projectId: string, path: string) => {
    const configured = await c.management(projectId).configureRepository(projectId, path);
    await c.recoverDocuments(projectId);
    await c.startWatcher(projectId);
    return configured;
  };
  return {
    'project:list': () => c.store.listProjects(),
    'project:create': serial(([raw]) => createProject(c, (raw ?? {}) as CreateProjectInput)),
    'project:open': serial(async ([raw]) => {
      const id = text(raw);
      const workspace = c.store.openProject(id);
      const project = workspace.projects.findById(id)!;
      await c.recoverDocuments(id);
      await c.startWatcher(id);
      c.execution(id).reconcileInterrupted(id);
      c.pilot(id).reconcile(id);
      const graph = new GetGraphViewUseCase(workspace.projects, workspace.graph).execute(id);
      const selectedEntityId = graph.nodes.find(node => node.type === 'PROJECT_ROOT')?.id ?? graph.nodes[0]?.id ?? '';
      const loaded: WorkspaceLoadedStateDto = { project: toProjectSummary(project), graph, selectedEntityId };
      return loaded;
    }),
    'repository:configure': serial(([projectId, path]) => connectRepository(text(projectId), text(path))),
    'repository:initialize': serial(async ([raw, path]) => {
      const projectId = text(raw);
      const project = c.store.openProject(projectId).projects.findById(projectId)!;
      const created = await new GitRepositoryInitializer().initialize({
        path: text(path),
        projectName: project.props.name,
        description: project.props.description ?? null,
      });
      const configured = await connectRepository(projectId, created.localPath);
      const { stage, status } = c.inception(projectId).get(projectId);
      c.emit('inception:updated', { projectId, stage, status });
      return { projectId, localPath: configured.localPath, initialCommit: created.initialCommit, files: created.files };
    }),
    'entity:get_inspector_details': ([raw]) => inspectorDetails(c, text(raw)),
    'graph:context_flow': ([projectId, workItemId]) => contextFlow(c, text(projectId), text(workItemId)),
    'pilot:get': ([raw, featureId]) => {
      const projectId = text(raw);
      const service = c.execution(projectId);
      return {
        ...c.pilot(projectId).status(projectId, text(featureId)),
        authMode: service.authMode(projectId),
        apiKeyAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
        availableModels:
          service.listProfiles(projectId).find(profile => profile.roleKey === 'DEVELOPER')?.availableModels ?? [],
        integration: withIds(service.featureIntegration(projectId, text(featureId)), projectId, text(featureId)),
      };
    },
    'changeset:propose_from_chat': args => proposeFromChat(c, args),
  };
}

async function createProject(c: Container, raw: CreateProjectInput) {
  const { location, ...input } = raw;
  // The folder is checked before creating anything, so the usual mistakes leave no half-made project behind.
  if (location) await checkProjectLocation(location);
  const workspace = c.store.createProject(input as CreateProjectInput);
  const project = workspace.projects.findById(workspace.id)!;
  if (location)
    try {
      const path =
        location.mode === 'NEW_FOLDER'
          ? (
              await new GitRepositoryInitializer().initialize({
                path: location.path,
                projectName: project.props.name,
                description: project.props.description ?? null,
              })
            ).localPath
          : location.path;
      await c.management(workspace.id).configureRepository(workspace.id, path);
    } catch (error) {
      c.store.discardProject(workspace.id);
      throw error;
    }
  return toProjectSummary(project);
}

const withIds = (state: FeatureIntegrationStateDto | null, projectId: string, featureId: string) =>
  state ? { ...state, projectId, featureId } : null;

/** Resolves the entity's project from the registry without exposing its database path to the renderer. */
function inspectorDetails(c: Container, id: string) {
  for (const project of c.store.listProjects()) {
    const workspace = c.store.openProject(project.id);
    if (!workspace.graph.findEntityById(id)) continue;
    const details = new GetEntityInspectorDetailsUseCase(workspace.graph).execute(id);
    if (details.entity.type === 'FEATURE') {
      const integration = withIds(c.execution(project.id).featureIntegration(project.id, id), project.id, id);
      return integration ? { ...details, integration } : details;
    }
    if (details.entity.type === 'DECISION_RECORD')
      return { ...details, allowedStatusChanges: decisionTransitions(details.entity.status) };
    if (details.entity.type !== 'WORK_ITEM') return details;
    const outcome = c.execution(project.id).taskOutcome(id);
    return {
      ...details,
      allowedStatusChanges: manualWorkItemTransitions(details.entity.status as WorkItemStatus),
      ...(outcome
        ? {
            outcome: {
              summary: outcome.summary,
              files: outcome.files,
              checks: outcome.checks,
              mergedCommit: outcome.mergedCommit,
              integrationBranch: outcome.integrationBranch,
              createdAt: outcome.createdAt,
            },
          }
        : {}),
    };
  }
  throw new Error(`Entity not found: ${id}`);
}

/** What the last run of a task received: the entities of its context, with their authority tier. */
function contextFlow(c: Container, projectId: string, workItemId: string) {
  const latest = c
    .execution(projectId)
    .listExecutions(projectId)
    .filter(execution => execution.workItemId === workItemId && execution.contextSnapshotId)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
  if (!latest?.contextSnapshotId) return { executionId: null, snapshotId: null, sources: [], conventions: [] };
  const snapshot = c.context(projectId).getSnapshot(latest.contextSnapshotId);
  const known = new Set(
    c.store
      .openProject(projectId)
      .graph.listEntities(projectId)
      .map(entity => entity.id),
  );
  return {
    executionId: latest.id,
    snapshotId: snapshot.id,
    sources: snapshot.includedSources
      .filter(source => known.has(source.sourceId) && source.sourceId !== workItemId)
      .map(source => ({ entityId: source.sourceId, tier: source.authorityTier, origin: source.retrievalOrigin })),
    conventions: snapshot.includedSources
      .filter(source => source.sourceId.startsWith('convention:'))
      .map(source => source.extractedContent),
  };
}
