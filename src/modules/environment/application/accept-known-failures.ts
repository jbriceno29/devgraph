import type { VerificationBaselineDto } from '../../../shared/contracts/verification-baseline.js';
import { failingCommands } from '../domain/verification-baseline.js';
import type { GetVerificationBaseline } from './get-verification-baseline.js';
import type { BaselineStorePort, PolicyChecksPort } from './ports/baseline-port.js';

/**
 * Plan REP, R2: «Aceptar estos fallos como conocidos». Only commands that fail in the baseline can be accepted; they
 * leave the verification and the pilot can run, while the task «Dejar la verificación en verde» fixes them.
 */
export class AcceptKnownFailures {
  constructor(
    private readonly store: BaselineStorePort,
    private readonly status: GetVerificationBaseline,
    private readonly policy: PolicyChecksPort,
  ) {}

  execute(projectId: string, commands: unknown): VerificationBaselineDto {
    const baseline = this.store.get(projectId);
    if (!baseline) throw new Error('Primero hay que comprobar la verificación del repositorio.');
    const failing = failingCommands(baseline);
    const chosen = (Array.isArray(commands) ? commands : []).map(String);
    const unknown = chosen.filter(command => !failing.includes(command));
    if (unknown.length) throw new Error(`Estos comandos no fallan en la línea base: ${unknown.join(', ')}.`);
    const known = [...new Set(chosen)];
    this.store.save(projectId, { ...baseline, knownFailing: known });
    this.policy.exclude(projectId, known);
    this.policy.restore(
      projectId,
      baseline.knownFailing.filter(command => !known.includes(command)),
    );
    return this.status.execute(projectId);
  }
}
