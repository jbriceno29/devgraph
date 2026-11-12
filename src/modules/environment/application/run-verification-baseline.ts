import type { VerificationBaselineDto } from '../../../shared/contracts/verification-baseline.js';
import { outputTail, testCounts, type VerificationBaseline } from '../domain/verification-baseline.js';
import type { BaselineRegistry } from './baseline-registry.js';
import type { GetVerificationBaseline } from './get-verification-baseline.js';
import type {
  BaselineCommandsPort,
  BaselineRunnerPort,
  BaselineStorePort,
  PolicyChecksPort,
} from './ports/baseline-port.js';

/**
 * Plan REP, R2: runs the project's checks once on a copy of the base branch, in the background (an install and the
 * tests take a while), and stores the result. Known failures the user accepted stay accepted while they still fail.
 */
export class RunVerificationBaseline {
  constructor(
    private readonly store: BaselineStorePort,
    private readonly registry: BaselineRegistry,
    private readonly runner: BaselineRunnerPort,
    private readonly commands: BaselineCommandsPort,
    private readonly status: GetVerificationBaseline,
    private readonly policy: PolicyChecksPort,
  ) {}

  execute(projectId: string, requested?: unknown): VerificationBaselineDto {
    if (this.registry.get(projectId)) return this.status.execute(projectId);
    const commands =
      requested === undefined || requested === null ? this.commands.defaults(projectId) : list(requested);
    const problems = this.commands.issues(commands);
    if (problems.length) throw new Error(problems.join(' '));
    if (!commands.length)
      throw new Error('No hay comprobaciones que correr: añade al menos un comando de verificación.');
    this.registry.start(projectId, commands);
    const previous = this.store.get(projectId);
    void this.runner
      .run({ projectId, commands })
      .then(
        run => {
          const next = baselineOf(run, previous);
          this.store.save(projectId, next);
          // A known failure that passes now (its fix was integrated) goes back to the verification.
          this.policy.restore(
            projectId,
            (previous?.knownFailing ?? []).filter(command => !next.knownFailing.includes(command)),
          );
        },
        error =>
          this.store.save(projectId, {
            ranAt: new Date().toISOString(),
            ref: '',
            commit: '',
            checks: [],
            knownFailing: previous?.knownFailing ?? [],
            error: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => this.registry.finish(projectId));
    return this.status.execute(projectId);
  }
}

const list = (value: unknown): string[] =>
  [...new Set((Array.isArray(value) ? value : []).map(item => String(item ?? '').trim()))].filter(Boolean);

function baselineOf(
  run: Awaited<ReturnType<BaselineRunnerPort['run']>>,
  previous: VerificationBaseline | null,
): VerificationBaseline {
  const checks = run.results.map(result => ({
    command: result.command,
    passed: result.exitCode === 0,
    ...(result.timedOut ? { timedOut: true } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    tail: outputTail(result.output),
    counts: testCounts(result.output),
  }));
  const failing = new Set(checks.filter(check => !check.passed).map(check => check.command));
  return {
    ranAt: new Date().toISOString(),
    ref: run.ref,
    commit: run.commit,
    checks,
    knownFailing: (previous?.knownFailing ?? []).filter(command => failing.has(command)),
    ...(run.error ? { error: run.error } : {}),
  };
}
