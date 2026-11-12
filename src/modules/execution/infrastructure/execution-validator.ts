import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runChecks } from './run-checks.js';
import type { AutonomyPolicy } from '../domain/governance.js';
import type { ExecutionValidatorPort, WorkspaceEnvironmentPort } from '../application/ports/agent-execution-port.js';
import type { ProjectEnvironment } from '../../projects/index.js';
import { qualityFlags } from '../domain/quality-flags.js';
import { resultSummary as summary } from '../domain/result-summary.js';
import {
  GitRunner,
  commitAll,
  pinnedGit,
  resolveWorktreeGitDir,
  restoreGitPointer,
  auditSymlinks,
  redactedChangeType,
  splitNul,
  safeRepoPath,
  isDenied,
  isReadOnly,
  matchesAny,
} from './validator-audit.js';
export { glob } from './validator-audit.js';

/** Captures the isolated diff, audits every changed path and runs only policy-allowlisted checks. */
export class ExecutionValidator implements ExecutionValidatorPort {
  /** `environment` (plan S2) reconciles the dependencies the app installs; without it a run with an environment fails closed. */
  constructor(
    private readonly workspaceRoot: string,
    private readonly recordDiffs: (executionId: string, repositoryId: string, diffs: ExecutionFileDiff[]) => void,
    private readonly environment: Pick<WorkspaceEnvironmentPort, 'reconcile'> | null = null,
  ) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    if (!/^[a-f0-9-]{36}$/i.test(input.projectId) || !/^[a-f0-9-]{36}$/i.test(input.executionId))
      throw new Error('Invalid identifiers for execution artifact paths.');
    const worktree = input.workingDirectory;
    // The worktree is agent-writable, so its `.git` pointer and any config it leads to are untrusted.
    // Resolve the admin directory from the main repository and pin every Git call to it.
    const gitDir = await resolveWorktreeGitDir(input.repositoryRoot, worktree);
    const pointerTampered = await restoreGitPointer(worktree, gitDir);
    const run: GitRunner = args => pinnedGit(worktree, gitDir, args);
    const audit = await auditChanges(run, worktree, input, pointerTampered);
    const executionDirectory = join(this.workspaceRoot, 'projects', input.projectId, 'executions', input.executionId);
    const diffRows = await this.recordAudit(run, input, audit, executionDirectory);
    if (audit.violations.length) return this.rejectViolations(run, input, audit, executionDirectory);
    const environment = await this.reconcileEnvironment(run, input, executionDirectory);
    if ('failure' in environment) return environment.failure;
    return this.verify(run, input, audit, diffRows, executionDirectory, environment.log);
  }

  /** Writes changes.patch and the diff rows (denied paths redacted, ignored violations listed). */
  private async recordAudit(
    run: GitRunner,
    input: ValidateInput,
    audit: Audit,
    executionDirectory: string,
  ): Promise<ExecutionFileDiff[]> {
    const worktree = input.workingDirectory;
    // Denied paths may hold secrets: never stage them nor copy their content into the patch or diff rows.
    const denied = new Set(audit.paths.filter(path => isDenied(path, input.policy.deniedPaths)));
    const auditable = audit.paths.filter(path => !denied.has(path));
    const stageable = audit.untracked.map(safeRepoPath).filter(path => !denied.has(path));
    if (stageable.length) await run(['add', '-N', '--', ...stageable]);
    const patch = auditable.length
      ? await run(['diff', '--no-ext-diff', '--binary', input.initialCommit, '--', ...auditable])
      : '';
    await mkdir(executionDirectory, { recursive: true });
    await writeFile(join(executionDirectory, 'changes.patch'), patch, 'utf8');
    const diffRows = await this.readDiffRows(run, worktree, input.initialCommit, auditable, audit.untracked);
    const deniedRows = await Promise.all(
      [...denied].map(async filePath => ({
        filePath,
        changeType: await redactedChangeType(worktree, filePath, audit.untracked.includes(filePath)),
        additions: 0,
        deletions: 0,
        diffPatch: null,
      })),
    );
    const ignoredViolationRows = audit.violations
      .filter(path => audit.ignoredPaths.includes(path) && !audit.paths.includes(path))
      .map(filePath => ({ filePath, changeType: 'ADDED' as const, additions: 0, deletions: 0, diffPatch: null }));
    this.recordDiffs(input.executionId, input.repositoryId, [...diffRows, ...deniedRows, ...ignoredViolationRows]);
    return diffRows;
  }

  /** Reverts what the agent touched outside its policy and fails the run with the list. */
  private async rejectViolations(
    run: GitRunner,
    input: ValidateInput,
    audit: Audit,
    executionDirectory: string,
  ): Promise<ValidationResult> {
    await this.revertPaths(
      run,
      input.workingDirectory,
      input.initialCommit,
      audit.violations.filter(path => path !== '.git'),
      [...audit.untracked, ...audit.ignoredPaths],
    );
    const resultSummary = summary.sandboxViolation(audit.violations);
    await writeFile(join(executionDirectory, 'test-output.log'), `${resultSummary}\n`, 'utf8');
    return {
      passed: false,
      finalCommit: null,
      resultSummary,
      testSummary: {
        passed: false,
        reason: 'SANDBOX_POLICY_VIOLATION',
        violations: audit.violations,
        patchPath: 'changes.patch',
        testLogPath: 'test-output.log',
      },
    };
  }

  /** Plan S2: refuses packages nobody approved and reinstalls when the manifest changed, before the checks. */
  private async reconcileEnvironment(
    run: GitRunner,
    input: ValidateInput,
    executionDirectory: string,
  ): Promise<{ log: string } | { failure: ValidationResult }> {
    if (!input.environment) return { log: '' };
    const baseManifest = await run(['show', `${input.initialCommit}:package.json`]).catch(() => null);
    const reconciled = this.environment
      ? await this.environment.reconcile({
          workingDirectory: input.workingDirectory,
          baseManifest,
          environment: input.environment,
        })
      : {
          ok: false as const,
          reason: 'ENVIRONMENT' as const,
          unapproved: [],
          log: 'No hay un gestor del entorno para reinstalar las dependencias.',
        };
    if (reconciled.ok) return { log: reconciled.log ? `${reconciled.log}\n\n` : '' };
    await writeFile(join(executionDirectory, 'test-output.log'), `${reconciled.log}\n`, 'utf8');
    const resultSummary =
      reconciled.reason === 'DEPENDENCY_APPROVAL'
        ? `Dependencias sin aprobar: ${reconciled.unapproved.join(', ')}. Apruébalas para que la app las instale, o pide otro enfoque.`
        : `No se pudo preparar el entorno: ${reconciled.log}`;
    return {
      failure: {
        passed: false,
        finalCommit: null,
        resultSummary,
        testSummary: {
          passed: false,
          reason: reconciled.reason,
          packages: reconciled.unapproved,
          patchPath: 'changes.patch',
          testLogPath: 'test-output.log',
        },
      },
    };
  }

  /** Runs the policy's checks; accepted work is committed on the execution branch so it is reviewed as a unit. */
  private async verify(
    run: GitRunner,
    input: ValidateInput,
    audit: Audit,
    diffRows: ExecutionFileDiff[],
    executionDirectory: string,
    environmentLog: string,
  ): Promise<ValidationResult> {
    const testReport = await runChecks(input.workingDirectory, input.policy.allowedCommands);
    await writeFile(join(executionDirectory, 'test-output.log'), environmentLog + testReport.log, 'utf8');
    const failed = testReport.results.find(result => result.exitCode !== 0);
    if (!failed && input.commitMessage) await commitAll(run, input.commitMessage, audit.environmentPaths);
    const finalCommit = (await run(['rev-parse', 'HEAD'])).trim();
    // Plan S5: what may have weakened the verification goes with the result; the autopilot does not accept it on its own.
    const flags = qualityFlags(diffRows);
    return {
      passed: !failed,
      finalCommit,
      resultSummary: failed ? summary.checkFailed(failed.command) : summary.passed(testReport.results.length > 0),
      testSummary: {
        passed: !failed,
        commands: testReport.results,
        skipped: testReport.results.length === 0,
        patchPath: 'changes.patch',
        testLogPath: 'test-output.log',
        ...(flags.length ? { qualityFlags: flags } : {}),
      },
    };
  }

  private async readDiffRows(
    run: GitRunner,
    cwd: string,
    base: string,
    paths: string[],
    untracked: string[],
  ): Promise<ExecutionFileDiff[]> {
    if (!paths.length) return [];
    const numstat = splitNul(await run(['diff', '--numstat', '-z', base, '--', ...paths]));
    const counts = new Map<string, { additions: number; deletions: number }>();
    // Git's -z numstat encodes each record as add<TAB>del<TAB>path\0.
    for (const row of numstat) {
      const fields = row.split('\t');
      if (fields.length < 3) continue;
      counts.set(fields.slice(2).join('\t'), { additions: Number(fields[0]) || 0, deletions: Number(fields[1]) || 0 });
    }
    return Promise.all(
      paths.map(async path => {
        const count = counts.get(path) ?? { additions: 0, deletions: 0 };
        const exists = await lstat(join(cwd, ...path.split('/'))).then(
          () => true,
          () => false,
        );
        const existed = untracked.includes(path)
          ? false
          : await run(['cat-file', '-e', `${base}:${path}`]).then(
              () => true,
              () => false,
            );
        const changeType = !existed && exists ? 'ADDED' : existed && exists ? 'MODIFIED' : 'DELETED';
        const diffPatch = await run(['diff', '--no-ext-diff', '--binary', base, '--', path]);
        return { filePath: path, changeType, additions: count.additions, deletions: count.deletions, diffPatch };
      }),
    );
  }

  private async revertPaths(
    run: GitRunner,
    cwd: string,
    base: string,
    violations: string[],
    untracked: string[],
  ): Promise<void> {
    const remove = violations.filter(path => untracked.includes(path));
    const restore = violations.filter(path => !untracked.includes(path));
    if (restore.length) await run(['restore', '--source', base, '--staged', '--worktree', '--', ...restore]);
    for (const path of remove) await rm(join(cwd, ...path.split('/')), { recursive: true, force: true });
  }
}

export interface ExecutionFileDiff {
  filePath: string;
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  additions: number;
  deletions: number;
  diffPatch: string | null;
}

interface ValidateInput {
  projectId: string;
  executionId: string;
  workingDirectory: string;
  repositoryRoot: string;
  repositoryId: string;
  initialCommit: string;
  policy: AutonomyPolicy;
  commitMessage?: string;
  environment?: ProjectEnvironment;
  ownedPaths?: string[];
}
type ValidationResult = { passed: boolean; finalCommit: string | null; resultSummary: string; testSummary: unknown };
interface Audit {
  paths: string[];
  untracked: string[];
  ignoredPaths: string[];
  violations: string[];
  environmentPaths: string[];
}

/** What changed in the worktree and what of it breaks the policy (paths, symlinks, the environment, a tampered .git). */
async function auditChanges(
  run: GitRunner,
  worktree: string,
  input: ValidateInput,
  pointerTampered: boolean,
): Promise<Audit> {
  const policy = input.policy;
  const tracked = splitNul(await run(['diff', '--name-only', '-z', input.initialCommit, '--']));
  // Plan S2: what the app installed (node_modules) is the environment, not the agent's work; the agent may not touch npm's config.
  const environmentPaths = [...(input.environment?.paths ?? []), ...(input.ownedPaths ?? [])],
    isEnvironment = (path: string) => environmentPaths.some(root => path === root || path.startsWith(`${root}/`));
  const untracked = splitNul(await run(['ls-files', '--others', '--exclude-standard', '-z'])).filter(
    path => !isEnvironment(safeRepoPath(path)),
  );
  const ignored = splitNul(
    await run(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']),
  ).filter(path => !isEnvironment(safeRepoPath(path)));
  const paths = [...new Set([...tracked, ...untracked])].map(safeRepoPath);
  const ignoredPaths = [...new Set(ignored.map(safeRepoPath))];
  const policyViolations = [...new Set([...paths, ...ignoredPaths])].filter(
    path =>
      isDenied(path, policy.deniedPaths) ||
      isReadOnly(path, policy.readonlyPaths) ||
      !matchesAny(path, policy.writablePaths) ||
      isEnvironment(path) ||
      (input.environment !== undefined && /(^|\/)\.npmrc$/i.test(path)),
  );
  const symlinkViolations = await auditSymlinks(worktree, paths, policy);
  const violations = [...new Set([...(pointerTampered ? ['.git'] : []), ...policyViolations, ...symlinkViolations])];
  return { paths, untracked, ignoredPaths, violations, environmentPaths };
}
