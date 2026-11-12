import type { FeatureIntegrationChannels, FeatureIntegrationCommands } from './feature-conflicts.js';
import type { RepositoryGitChannels, RepositoryGitCommands } from './repository-git.js';

/**
 * Channels added after `ipc-contracts.ts` hit its size limit: each group lives in its own contract and joins the IPC
 * surface here (new groups are added to these two types, not to `ipc-contracts.ts`).
 */
export interface IpcExtensionChannels extends FeatureIntegrationChannels, RepositoryGitChannels {}
export type IpcExtensionCommands = FeatureIntegrationCommands & RepositoryGitCommands;
