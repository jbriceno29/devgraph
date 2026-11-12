import { describe, expect, it } from 'vitest';
import { condenseOutcomeSummary } from '../../src/modules/execution/domain/task-outcome.js';

const summary = `Listo.

**Hecho**
- src/a.js: añade sumar.

**Decisiones**
- Firma con objeto de opciones.

**Convenciones**
- Los errores de tipo lanzan TypeError.

**Pendiente**
- Falta documentar.`;

describe('condenseOutcomeSummary', () => {
  it('always drops the conventions (they already reach the prompt as rules) and keeps the rest for a direct prerequisite', () => {
    const text = condenseOutcomeSummary(summary, false);
    expect(text).toContain('Listo.');
    expect(text).toContain('añade sumar');
    expect(text).toContain('Firma con objeto de opciones');
    expect(text).toContain('Falta documentar');
    expect(text).not.toContain('TypeError');
    expect(text).not.toContain('Convenciones');
  });

  it('keeps only what was done for a task that is not a direct prerequisite', () => {
    const text = condenseOutcomeSummary(summary, true);
    expect(text).toContain('Listo.');
    expect(text).toContain('añade sumar');
    expect(text).not.toMatch(/Decisiones|Firma con objeto|Falta documentar|TypeError/);
  });

  it('returns a summary without the sections untouched, and never an empty text', () => {
    expect(condenseOutcomeSummary('Hice todo como pediste.', true)).toBe('Hice todo como pediste.');
    expect(condenseOutcomeSummary('**Convenciones**\n- Solo reglas', true)).toBe('**Convenciones**\n- Solo reglas');
  });

  it('understands markdown headings and inline section text', () => {
    const text = condenseOutcomeSummary(
      '## Hecho\nCambié x.\n## Decisiones: usé y\n## Convenciones: regla z\n## Pendiente\nnada',
      true,
    );
    expect(text).toBe('## Hecho\nCambié x.');
  });
});
