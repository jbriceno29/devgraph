import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NpmEnvironment } from '../../modules/environment/infrastructure/npm-environment.js';
import { SqliteProjectEnvironmentRepository } from '../../modules/environment/infrastructure/sqlite-project-environment.js';
import type { IntegrationCommandsPort } from '../../modules/execution/application/ports/feature-check-port.js';
import { GitFeatureChecks } from '../../modules/execution/infrastructure/feature-checks.js';
import { parseApprovedPackages } from '../../modules/projects/domain/approved-packages.js';
import { integrationChecks } from '../../modules/projects/domain/agent-access.js';
import { environmentFor, findStackProfile } from '../../modules/projects/domain/stack-catalog.js';
import type { Container } from '../container.js';

const execFileAsync = promisify(execFile);
const show = (root: string, ref: string) =>
  execFileAsync('git', ['show', ref], { cwd: root, maxBuffer: 4 * 1024 * 1024 }).then(
    result => result.stdout,
    () => null,
  );

/** Plan C6: the throwaway-worktree runner of a feature's integration checks, with the project's environment. */
export function featureCheckRunner(c: Container): GitFeatureChecks {
  const stack = (projectId: string) =>
    new SqliteProjectEnvironmentRepository(c.store.openProject(projectId).database).stack(projectId);
  return new GitFeatureChecks({
    workspaceRoot: c.workspaceRoot,
    installer: c.dependencies.environmentInstaller ?? new NpmEnvironment(),
    environmentFor: projectId => {
      const row = stack(projectId);
      return environmentFor(row?.stackProfileId, parseApprovedPackages(row?.approvedDependenciesJson));
    },
  });
}

/** The project's integration checks: its catalog profile's, or the `build` script of the feature branch's package.json. */
export function integrationCommands(c: Container): IntegrationCommandsPort {
  return {
    commands: async (projectId, branch) => {
      const row = new SqliteProjectEnvironmentRepository(c.store.openProject(projectId).database).stack(projectId);
      const profile = findStackProfile(row?.stackProfileId),
        root = c.repositoryPath(projectId);
      if (profile || !root) return [...(profile?.integrationCommands ?? [])];
      return integrationChecks({
        profileCommands: null,
        packageJson: await show(root, `${branch}:package.json`),
        pnpm: (await show(root, `${branch}:pnpm-lock.yaml`)) !== null,
        verificationCommands: c.execution(projectId).getPolicy(projectId).allowedCommands,
      });
    },
  };
}
