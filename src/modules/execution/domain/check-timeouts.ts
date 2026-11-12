/**
 * Plan C6: each check has its own time limit. Builds and end-to-end tests (`next build`, `vite build`, Playwright) take
 * minutes; types, lint and unit tests are expected to finish in two.
 */
export const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
export const LONG_CHECK_TIMEOUT_MS = 600_000;
const LONG = /(?:^|[\s/:])(?:build|e2e|test:e2e|playwright|cypress)(?:\s|$)/i;

export function checkTimeoutMs(command: string): number {
  return LONG.test(command) ? LONG_CHECK_TIMEOUT_MS : DEFAULT_CHECK_TIMEOUT_MS;
}

/** What the log says when a check ran out of time (not the same as failing). */
export function timedOutNote(timeoutMs: number): string {
  return `La comprobación se cortó a los ${Math.round(timeoutMs / 1000)} s sin terminar: no falló, tardó más de lo permitido.`;
}
