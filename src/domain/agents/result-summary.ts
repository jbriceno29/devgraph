/**
 * What the validation of a run says, in Spanish (C1 of the UX audit). Runs stored before this change keep their English
 * text in the database: `readableResultSummary` translates it wherever a summary is shown.
 */
export const resultSummary = {
  sandboxViolation: (paths: string[]) => `El agente tocó rutas que no tiene permitidas: ${paths.join(', ')}.`,
  checkFailed: (command: string) => `Falló la comprobación \`${command}\`.`,
  passed: (checksRan: boolean) =>
    checksRan
      ? 'Los cambios solo tocan rutas permitidas y las comprobaciones pasaron.'
      : 'Los cambios solo tocan rutas permitidas. No hay comandos de verificación configurados.',
};

const legacy: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Sandbox audit failed\. Unauthorized paths: (.*)$/s, m => resultSummary.sandboxViolation(m[1]!.split(', '))],
  [/^Verification command failed: (.*)$/s, m => resultSummary.checkFailed(m[1]!)],
  [/^Diff audit passed\. Configured checks passed\.$/, () => resultSummary.passed(true)],
  [/^Diff audit passed\. No verification commands are allowlisted\.$/, () => resultSummary.passed(false)],
  [/^Diff audit passed\.$/, () => 'Los cambios solo tocan rutas permitidas.'],
];

export function readableResultSummary(text: string): string;
export function readableResultSummary(text: string | null): string | null;
export function readableResultSummary(text: string | null): string | null {
  if (!text) return text;
  for (const [pattern, translate] of legacy) {
    const match = text.match(pattern);
    if (match) return translate(match);
  }
  return text;
}
