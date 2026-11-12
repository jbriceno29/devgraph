import { activityHandlers } from '../modules/activity/ipc.js';
import { autopilotHandlers } from '../modules/autopilot/ipc.js';
import { contextHandlers } from '../modules/context/ipc.js';
import { documentsHandlers } from '../modules/documents/ipc.js';
import { environmentHandlers } from '../modules/environment/ipc.js';
import { executionHandlers } from '../modules/execution/ipc.js';
import { inceptionHandlers } from '../modules/inception/ipc.js';
import { knowledgeHandlers } from '../modules/knowledge/ipc.js';
import { planningHandlers } from '../modules/planning/ipc.js';
import { projectsHandlers } from '../modules/projects/ipc.js';
import type { IpcCommandChannel, IpcQueryChannel } from '../shared/contracts/ipc-contracts.js';
import { createContainer, type CoreDependencies, type WorkspaceEventEmitter } from './container.js';
import { repositoryGitHandlers } from './handlers/repository-git.js';
import { workspaceHandlers } from './handlers/workspace.js';
import { createIpcRouter } from './ipc-router.js';

export type { CoreDependencies, WorkspaceEventEmitter } from './container.js';
export interface WorkspaceRequest {
  channel: IpcCommandChannel | IpcQueryChannel;
  args: unknown[];
}

/** The Node core: the services of every module (container) and the IPC channels each module answers (router). */
export function createWorkspaceCore(
  workspaceRoot: string,
  emit: WorkspaceEventEmitter = () => undefined,
  dependencies: CoreDependencies = {},
) {
  const c = createContainer(workspaceRoot, emit, dependencies);
  const router = createIpcRouter([
    workspaceHandlers(c),
    repositoryGitHandlers(c),
    projectsHandlers(c),
    knowledgeHandlers(c),
    planningHandlers(c),
    inceptionHandlers(c),
    contextHandlers(c),
    documentsHandlers(c),
    environmentHandlers(c),
    executionHandlers(c),
    autopilotHandlers(c),
    activityHandlers(c),
  ]);
  return {
    handle: ({ channel, args }: WorkspaceRequest): Promise<unknown> => router.handle(channel, args),
    isSerialized: (channel: string) => router.isSerialized(channel),
    channels: () => router.channels(),
    /** Resolves when the project's background inception call (if any) has finished (tests and shutdown). */
    async inceptionSettled(projectId: string): Promise<void> {
      await c.inceptionIfStarted(projectId)?.settled(projectId);
    },
    close: () => c.close(),
  };
}
