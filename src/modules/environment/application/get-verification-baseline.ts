import type { VerificationBaselineDto } from '../../../shared/contracts/verification-baseline.js';
import { blockingFailures, checkLine } from '../domain/verification-baseline.js';
import type { BaselineRegistry } from './baseline-registry.js';
import type { BaselineCommandsPort, BaselineStorePort } from './ports/baseline-port.js';

/** Plan REP, R2: the last verification baseline of the project, as Ajustes and the inception show it. */
export class GetVerificationBaseline {
  constructor(
    private readonly store: BaselineStorePort,
    private readonly registry: BaselineRegistry,
    private readonly commands: BaselineCommandsPort,
  ) {}

  execute(projectId: string): VerificationBaselineDto {
    const running = this.registry.get(projectId),
      baseline = this.store.get(projectId);
    const base = { ranAt: null, ref: null, checks: [], knownFailing: [], blocking: [], error: null };
    if (running) return { ...base, status: 'RUNNING', commands: running };
    if (!baseline) return { ...base, status: 'NOT_RUN', commands: this.commands.defaults(projectId) };
    return {
      status: 'DONE',
      commands: baseline.checks.map(check => check.command),
      ranAt: baseline.ranAt,
      ref: baseline.ref,
      checks: baseline.checks.map(({ counts, ...check }) => ({ ...check, summary: checkLine({ ...check, counts }) })),
      knownFailing: baseline.knownFailing,
      blocking: blockingFailures(baseline),
      error: baseline.error ?? null,
    };
  }
}
