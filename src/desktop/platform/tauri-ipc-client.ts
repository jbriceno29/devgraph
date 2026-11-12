import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { WorkspaceIpcClient, WorkspaceIpcEvents } from '../../shared/contracts/ipc-contracts.js';
const invokeCore = <T>(channel: string, args: unknown[] = []): Promise<T> =>
  invoke<T>('workspace_request', { request: { channel, args } });
export const workspaceIpc: WorkspaceIpcClient = {
  commands: {
    createProject: input => invokeCore('project:create', [input]),
    openProject: projectId => invokeCore('project:open', [projectId]),
    setProjectsFolder: path => invokeCore('settings:set_projects_folder', [path]),
    configureRepository: (projectId, localPath) => invokeCore('repository:configure', [projectId, localPath]),
    createArtifact: input => invokeCore('artifact:create', [input]),
    saveArtifact: (documentId, expectedContentHash, content) =>
      invokeCore('artifact:save', [documentId, expectedContentHash, content]),
    proposeChanges: (projectId, prompt, focusEntityId, contextSnapshotId, model, options) =>
      invokeCore(
        'changeset:propose_from_chat',
        options
          ? [projectId, prompt, focusEntityId, contextSnapshotId, model, options]
          : [projectId, prompt, focusEntityId, contextSnapshotId, model],
      ),
    translateReferences: (projectId, references) =>
      invokeCore('planning:translate_references', [projectId, references]),
    editChangeSet: (changeSetId, operations) => invokeCore('changeset:edit', [changeSetId, operations]),
    applyChangeSet: changeSetId => invokeCore('changeset:apply', [changeSetId]),
    rejectChangeSet: changeSetId => invokeCore('changeset:reject', [changeSetId]),
    startExecution: input => invokeCore('execution:start', [input]),
    cancelExecution: executionId => invokeCore('execution:cancel', [executionId]),
    resolveExecutionApproval: input => invokeCore('execution:resolve_approval', [input]),
    acceptExecution: executionId => invokeCore('execution:accept', [executionId]),
    requestExecutionChanges: input => invokeCore('execution:request_changes', [input]),
    setWorkItemStatus: (projectId, workItemId, status) =>
      invokeCore('workitem:set_status', [projectId, workItemId, status]),
    setDecisionStatus: (projectId, decisionId, status) =>
      invokeCore('decision:set_status', [projectId, decisionId, status]),
    updateExecutionPolicy: (projectId, policy) => invokeCore('policy:update', [projectId, policy]),
    approveDependencies: (projectId, packages) => invokeCore('environment:approve_dependencies', [projectId, packages]),
    setProjectSkills: (projectId, enabled) => invokeCore('environment:set_skills', [projectId, enabled]),
    startCommand: (projectId, input) => invokeCore('commands:start', [projectId, input]),
    stopCommand: (projectId, runId) => invokeCore('commands:stop', [projectId, runId]),
    setFeatureAutonomy: (projectId, featureId, input) =>
      invokeCore('pilot:set_autonomy', [projectId, featureId, input]),
    startPilot: (projectId, featureId, input) => invokeCore('pilot:start', [projectId, featureId, input]),
    stopPilot: (projectId, featureId) => invokeCore('pilot:stop', [projectId, featureId]),
    resumePilot: (projectId, featureId) => invokeCore('pilot:resume', [projectId, featureId]),
    setAuthMode: (projectId, mode) => invokeCore('provider:set_auth_mode', [projectId, mode]),
    exportFeatureReport: (projectId, featureId) => invokeCore('metrics:export_report', [projectId, featureId]),
    integrateFeature: (projectId, featureId) => invokeCore('feature:integrate', [projectId, featureId]),
    checkFeatureConflicts: (projectId, featureId) => invokeCore('feature:check_conflicts', [projectId, featureId]),
    resolveFeatureConflicts: (projectId, featureId) => invokeCore('feature:resolve_conflicts', [projectId, featureId]),
    getRepositoryGitStatus: projectId => invokeCore('repository:git_status', [projectId]),
    setBaseBranch: (projectId, branch) => invokeCore('repository:set_base_branch', [projectId, branch]),
  },
  platform: {
    async pickFolder({ title, defaultPath }) {
      const picked = await open({ directory: true, multiple: false, title, ...(defaultPath ? { defaultPath } : {}) });
      return typeof picked === 'string' ? picked : null;
    },
  },
  queries: {
    listProjects: () => invokeCore('project:list'),
    getAppSettings: () => invokeCore('settings:get'),
    inspectFolder: path => invokeCore('folder:inspect', [path]),
    getGraphView: (projectId, filter) => invokeCore('graph:get_view', [projectId, filter]),
    getEntityInspectorDetails: entityId => invokeCore('entity:get_inspector_details', [entityId]),
    getRepositoryPath: projectId => invokeCore('repository:get_path', [projectId]),
    listArtifacts: projectId => invokeCore('artifact:list', [projectId]),
    getArtifact: documentId => invokeCore('artifact:read', [documentId]),
    listChangeSets: projectId => invokeCore('changeset:list', [projectId]),
    getContextSnapshot: snapshotId => invokeCore('context:get_snapshot', [snapshotId]),
    previewContext: input => invokeCore('context:preview_package', [input]),
    listAgentProfiles: projectId => invokeCore('agent:list_profiles', [projectId]),
    listExecutions: projectId => invokeCore('execution:list', [projectId]),
    listExecutionEvents: executionId => invokeCore('execution:list_events', [executionId]),
    getExecutionDetail: executionId => invokeCore('execution:get_detail', [executionId]),
    getExecutionPolicy: projectId => invokeCore('policy:get', [projectId]),
    proposeAccessFromRepository: projectId => invokeCore('policy:propose_from_repository', [projectId]),
    getProjectEnvironment: projectId => invokeCore('environment:get', [projectId]),
    getCommandRefs: projectId => invokeCore('commands:refs', [projectId]),
    getProjectScripts: (projectId, ref) => invokeCore('commands:scripts', [projectId, ref]),
    listCommands: projectId => invokeCore('commands:list', [projectId]),
    getFeaturePilot: (projectId, featureId) => invokeCore('pilot:get', [projectId, featureId]),
    getProviderAuth: projectId => invokeCore('provider:get_auth', [projectId]),
    getContextFlow: (projectId, workItemId) => invokeCore('graph:context_flow', [projectId, workItemId]),
    getFeatureReport: (projectId, featureId) => invokeCore('metrics:feature_report', [projectId, featureId]),
    getActivity: (projectId, limit) => invokeCore('activity:list', [projectId, limit]),
  },
  inception: {
    get: projectId => invokeCore('inception:get', [projectId]),
    start: (projectId, input) => invokeCore('inception:start', [projectId, input]),
    answer: (projectId, answers, notes, options) =>
      invokeCore(
        'inception:answer',
        options === undefined
          ? notes === undefined
            ? [projectId, answers]
            : [projectId, answers, notes]
          : [projectId, answers, notes ?? null, options],
      ),
    importPrototype: (projectId, input) => invokeCore('inception:import_prototype', [projectId, input]),
    importDesign: (projectId, input) => invokeCore('inception:import_design', [projectId, input]),
    reviseUiOption: (projectId, optionId, notes) => invokeCore('inception:revise_ui', [projectId, optionId, notes]),
    chooseUiOption: (projectId, optionId) => invokeCore('inception:choose_ui', [projectId, optionId]),
    reopenDesign: projectId => invokeCore('inception:reopen_design', [projectId]),
    getUiPrototype: (projectId, optionId) => invokeCore('inception:get_ui_prototype', [projectId, optionId]),
    approve: projectId => invokeCore('inception:approve', [projectId]),
    restart: projectId => invokeCore('inception:restart', [projectId]),
    initializeRepository: (projectId, absolutePath) => invokeCore('repository:initialize', [projectId, absolutePath]),
    scanRepository: projectId => invokeCore('repository:scan', [projectId]),
    onUpdated(listener) {
      return subscribe('inception:updated', listener);
    },
  },
  events: {
    onGraphRevisionUpdated(listener) {
      return subscribe('graph:revision_updated', listener);
    },
    onArtifactSyncStatusChanged(listener) {
      return subscribe('artifact:sync_status_changed', listener);
    },
    onExecutionStatusChanged(listener) {
      return subscribe('execution:status_changed', listener);
    },
    onExecutionEventReceived(listener) {
      return subscribe('execution:event_received', listener);
    },
    onPilotUpdated(listener) {
      return subscribe('pilot:updated', listener);
    },
    onCommandUpdated(listener) {
      return subscribe('command:updated', listener);
    },
    onCommandOutput(listener) {
      return subscribe('command:output', listener);
    },
  },
};
function subscribe<K extends keyof WorkspaceIpcEvents>(
  channel: K,
  listener: (event: WorkspaceIpcEvents[K]) => void,
): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void listen<WorkspaceIpcEvents[K]>(channel, event => listener(event.payload)).then(stop => {
    if (cancelled) stop();
    else unlisten = stop;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
