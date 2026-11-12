import type { VerificationBaselineDto } from '../../../shared/contracts/verification-baseline.js';

/** The baseline ran other commands than the ones on screen (the user edited the checks): it should run again. */
export function baselineOutdated(baseline: VerificationBaselineDto | null, commands: string[] | undefined): boolean {
  if (!baseline || baseline.status !== 'DONE' || !commands) return false;
  return [...baseline.commands].sort().join('\n') !== [...commands].sort().join('\n');
}

export const failingOf = (baseline: VerificationBaselineDto) =>
  baseline.checks.filter(check => !check.passed).map(check => check.command);
