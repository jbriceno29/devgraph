import { describe, expect, it } from 'vitest';
import { readableResultSummary, resultSummary } from '../../src/domain/agents/result-summary.js';

describe('resultados de la validación en español (C1)', () => {
  it('builds the summaries in Spanish', () => {
    expect(resultSummary.passed(true)).toBe('Los cambios solo tocan rutas permitidas y las comprobaciones pasaron.');
    expect(resultSummary.checkFailed('npm test')).toBe('Falló la comprobación `npm test`.');
    expect(resultSummary.sandboxViolation(['.env', 'secret.txt'])).toBe(
      'El agente tocó rutas que no tiene permitidas: .env, secret.txt.',
    );
  });
  it('translates the English summaries of runs stored before the change and leaves the rest alone', () => {
    expect(readableResultSummary('Diff audit passed. Configured checks passed.')).toBe(resultSummary.passed(true));
    expect(readableResultSummary('Diff audit passed. No verification commands are allowlisted.')).toBe(
      resultSummary.passed(false),
    );
    expect(readableResultSummary('Verification command failed: npm test')).toBe(resultSummary.checkFailed('npm test'));
    expect(readableResultSummary('Sandbox audit failed. Unauthorized paths: .env, a.txt')).toBe(
      resultSummary.sandboxViolation(['.env', 'a.txt']),
    );
    expect(readableResultSummary('Dependencias sin aprobar: zod.')).toBe('Dependencias sin aprobar: zod.');
    expect(readableResultSummary(null)).toBeNull();
  });
});
