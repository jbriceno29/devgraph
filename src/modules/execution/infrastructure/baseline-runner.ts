import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { activeCheckDirectories, type FeatureCheckDependencies } from './feature-checks.js';
import { git } from './git-isolation-service.js';
import { resolveBaseBranch, withRepositoryLock } from './git-repository-state.js';
import { runChecks } from './run-checks.js';

/**
 * Plan REP, R2: runs the project's checks once on a throwaway copy of its base branch (under `checks/`, like C6), with
 * the environment installed the usual way (no install scripts). No branch moves and the user's checkout is not read.
 */
export class GitBaselineRunner {
  constructor(
    private readonly deps: FeatureCheckDependencies & {
      repositoryOf(projectId: string): string | null;
      configuredBase(projectId: string): string | null;
    },
  ) {}

  async run(input: { projectId: string; commands: string[] }) {
    const path = this.deps.repositoryOf(input.projectId);
    if (!path) throw new Error('El proyecto no tiene repositorio configurado.');
    const root = await realpath(path);
    const ref = await resolveBaseBranch(root, this.deps.configuredBase(input.projectId));
    const directory = join(this.deps.workspaceRoot, 'projects', input.projectId, 'checks', randomUUID());
    activeCheckDirectories.add(directory);
    const commit = await withRepositoryLock(root, async () => {
      const head = (await git(root, ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`])).trim();
      await mkdir(dirname(directory), { recursive: true });
      await git(root, ['worktree', 'add', '--quiet', '--detach', directory, head]);
      return head;
    });
    try {
      const environment = this.deps.environmentFor(input.projectId);
      if (environment)
        try {
          await this.deps.installer.provision({ workingDirectory: directory, projectName: 'baseline', environment });
        } catch (error) {
          return {
            ref,
            commit,
            results: [],
            error: `No se pudieron instalar las dependencias: ${(error as Error).message}`,
          };
        }
      const report = await runChecks(directory, input.commands, {
        ...process.env,
        CI: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      });
      return { ref, commit, results: report.results };
    } finally {
      await withRepositoryLock(root, async () => {
        await git(root, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
        await git(root, ['worktree', 'prune']).catch(() => undefined);
      });
      activeCheckDirectories.delete(directory);
    }
  }
}
