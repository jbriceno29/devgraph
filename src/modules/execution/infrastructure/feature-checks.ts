import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProjectEnvironment } from '../../projects/index.js';
import type { FeatureCheckRun, FeatureCheckRunnerPort } from '../application/ports/feature-check-port.js';
import { checksOf } from '../domain/check-summary.js';
import { git } from './git-isolation-service.js';
import { withRepositoryLock } from './git-repository-state.js';
import { runChecks } from './run-checks.js';

const identity = ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost'];
/** Folders of checks in progress in this process: the orphan cleanup on project open leaves them alone. */
export const activeCheckDirectories = new Set<string>();

export interface FeatureCheckDependencies {
  workspaceRoot: string;
  installer: {
    provision(input: { workingDirectory: string; projectName: string; environment: ProjectEnvironment }): Promise<{
      log: string;
    }>;
  };
  environmentFor(projectId: string): ProjectEnvironment | null;
}

/**
 * Plan C6: builds the merge of a feature into its base in a throwaway worktree (under the project's `checks/`), installs
 * the environment there and runs the integration checks. No branch moves. Only the worktree bookkeeping takes the
 * repository lock: a build of several minutes does not hold up the app's other git writes.
 */
export class GitFeatureChecks implements FeatureCheckRunnerPort {
  constructor(private readonly deps: FeatureCheckDependencies) {}

  async heads(repositoryRoot: string, targetBranch: string, branch: string) {
    const rev = async (name: string) =>
      (await git(repositoryRoot, ['rev-parse', '--verify', `refs/heads/${name}^{commit}`])).trim();
    return { base: await rev(targetBranch), feature: await rev(branch) };
  }

  async run(input: {
    projectId: string;
    repositoryRoot: string;
    targetBranch: string;
    branch: string;
    commands: string[];
  }): Promise<FeatureCheckRun> {
    const root = await realpath(input.repositoryRoot);
    const directory = join(this.deps.workspaceRoot, 'projects', input.projectId, 'checks', randomUUID());
    activeCheckDirectories.add(directory);
    const heads = await withRepositoryLock(root, async () => {
      const found = await this.heads(root, input.targetBranch, input.branch);
      await mkdir(dirname(directory), { recursive: true });
      await git(root, ['worktree', 'add', '--quiet', '--detach', directory, found.base]);
      return found;
    });
    const result = (passed: boolean, detail: string | null, checks: FeatureCheckRun['checks'] = []) => ({
      passed,
      checks,
      detail,
      baseCommit: heads.base,
      featureCommit: heads.feature,
    });
    try {
      return await this.check(directory, input, result);
    } finally {
      await withRepositoryLock(root, async () => {
        await git(root, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
        await git(root, ['worktree', 'prune']).catch(() => undefined);
      });
      activeCheckDirectories.delete(directory);
    }
  }

  private async check(
    directory: string,
    input: { projectId: string; branch: string; targetBranch: string; commands: string[] },
    result: (passed: boolean, detail: string | null, checks?: FeatureCheckRun['checks']) => FeatureCheckRun,
  ): Promise<FeatureCheckRun> {
    const run = (args: string[]) =>
      git(directory, ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${join(directory, '.no-hooks')}`, ...args]);
    const merged = await run([...identity, 'merge', '--no-ff', '--no-edit', '--quiet', input.branch]).then(
      () => true,
      () => false,
    );
    if (!merged)
      return result(false, `La feature choca con ${input.targetBranch}: resuelve el conflicto antes de comprobarla.`);
    const environment = this.deps.environmentFor(input.projectId);
    if (environment)
      try {
        await this.deps.installer.provision({ workingDirectory: directory, projectName: 'checks', environment });
      } catch (error) {
        return result(false, `No se pudieron instalar las dependencias: ${(error as Error).message}`);
      }
    const report = await runChecks(directory, input.commands, {
      ...process.env,
      CI: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    });
    const failed = report.results.find(item => item.exitCode !== 0);
    return result(!failed, failed ? failed.output.trim().slice(-2_000) : null, checksOf({ commands: report.results }));
  }
}
