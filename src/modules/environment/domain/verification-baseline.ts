/**
 * Plan REP, R2: how the repository's checks stand before the app plans anything. They run once on a copy of the base
 * branch; a check that already fails is not the agent's fault, and the plan starts by fixing it.
 */
export interface BaselineCheck {
  command: string;
  passed: boolean;
  timedOut?: boolean;
  durationMs?: number;
  /** Last lines of its output. */
  tail: string;
  /** Tests passed and failed, when the output says (Vitest, Jest, node:test, pytest). */
  counts: { passed: number; failed: number } | null;
}

export interface VerificationBaseline {
  ranAt: string;
  ref: string;
  commit: string;
  checks: BaselineCheck[];
  /** Failing commands the user accepted as known: excluded from verification until the fix task makes them pass. */
  knownFailing: string[];
  /** Why it could not run at all (an install that failed), if so. */
  error?: string;
}

const COUNT_PATTERNS: Array<(output: string) => { passed: number; failed: number } | null> = [
  // Vitest: "Tests  3 failed | 48 passed (51)"
  output => {
    const line = /^\s*Tests\s+(.+)$/m.exec(output)?.[1];
    if (!line || !/passed|failed/.test(line)) return null;
    const pick = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
    return { passed: pick('passed'), failed: pick('failed') };
  },
  // Jest: "Tests:       3 failed, 48 passed, 51 total"
  output => {
    const line = /^Tests:\s+(.+)$/m.exec(output)?.[1];
    if (!line) return null;
    const pick = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
    return { passed: pick('passed'), failed: pick('failed') };
  },
  // node:test: "ℹ pass 14" / "ℹ fail 0" (also "# pass 14" with the TAP reporter)
  output => {
    const pass = /^[ℹ#] pass (\d+)$/m.exec(output),
      fail = /^[ℹ#] fail (\d+)$/m.exec(output);
    return pass && fail ? { passed: Number(pass[1]), failed: Number(fail[1]) } : null;
  },
  // pytest / unittest: "3 failed, 48 passed in 1.2s", "Ran 12 tests … OK"
  output => {
    const line = /=+ (.*(?:passed|failed).*) in [\d.]+s/.exec(output)?.[1];
    if (!line) return null;
    const pick = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
    return { passed: pick('passed'), failed: pick('failed') };
  },
];

export function testCounts(output: string): { passed: number; failed: number } | null {
  for (const pattern of COUNT_PATTERNS) {
    const counts = pattern(output);
    if (counts) return counts;
  }
  return null;
}

/** «npm test: pasan 48, fallan 3», «npm run lint: pasa», «npm test: se cortó por tiempo». */
export function checkLine(check: Pick<BaselineCheck, 'command' | 'passed' | 'timedOut' | 'counts'>): string {
  const counts = check.counts
    ? `pasan ${check.counts.passed}${check.counts.failed ? `, fallan ${check.counts.failed}` : ''}`
    : null;
  const state = check.timedOut ? 'se cortó por tiempo' : (counts ?? (check.passed ? 'pasa' : 'falla'));
  return `${check.command}: ${state}`;
}

/** Commands that fail and the user did not accept as known: they block the pilot and the plan starts by fixing them. */
export function blockingFailures(baseline: VerificationBaseline | null): string[] {
  if (!baseline) return [];
  return baseline.checks
    .filter(check => !check.passed && !baseline.knownFailing.includes(check.command))
    .map(check => check.command);
}

export function failingCommands(baseline: VerificationBaseline | null): string[] {
  return (baseline?.checks ?? []).filter(check => !check.passed).map(check => check.command);
}

/** The last `lines` lines of an output, at most `chars` characters. */
export function outputTail(output: string, lines = 15, chars = 1_500): string {
  return output.trimEnd().split('\n').slice(-lines).join('\n').slice(-chars);
}
