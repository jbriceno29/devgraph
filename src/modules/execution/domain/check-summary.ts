/** Plan C6: one line per check of a run, for Revisión (the full output stays in test-output.log). */
export interface CheckSummary {
  command: string;
  passed: boolean;
  timedOut?: boolean;
  durationMs?: number;
}

/** The checks a validated run recorded in its test summary; empty when it did not get that far. */
export function checksOf(testSummary: unknown): CheckSummary[] {
  const commands = (testSummary as { commands?: unknown } | null)?.commands;
  if (!Array.isArray(commands)) return [];
  return commands.flatMap(item => {
    const entry = item as { command?: unknown; exitCode?: unknown; timedOut?: unknown; durationMs?: unknown };
    if (typeof entry.command !== 'string') return [];
    return [
      {
        command: entry.command,
        passed: entry.exitCode === 0,
        ...(entry.timedOut === true ? { timedOut: true } : {}),
        ...(typeof entry.durationMs === 'number' ? { durationMs: entry.durationMs } : {}),
      },
    ];
  });
}
