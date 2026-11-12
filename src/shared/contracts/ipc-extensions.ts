import type { FeatureChecksChannels, FeatureChecksCommands } from './feature-checks.js';
import type { FeatureIntegrationChannels, FeatureIntegrationCommands } from './feature-conflicts.js';
import type { ProjectDocsChannels, ProjectDocsCommands } from './project-docs.js';
import type { RepositoryGitChannels, RepositoryGitCommands } from './repository-git.js';
import type { VerificationBaselineChannels, VerificationBaselineCommands } from './verification-baseline.js';

/**
 * Channels added after `ipc-contracts.ts` hit its size limit: each group lives in its own contract and joins the IPC
 * surface here (new groups are added to these two types, not to `ipc-contracts.ts`).
 */
export interface IpcExtensionChannels
  extends FeatureIntegrationChannels,
    RepositoryGitChannels,
    ProjectDocsChannels,
    FeatureChecksChannels,
    VerificationBaselineChannels {}
export type IpcExtensionCommands = FeatureIntegrationCommands &
  RepositoryGitCommands &
  ProjectDocsCommands &
  FeatureChecksCommands &
  VerificationBaselineCommands;
