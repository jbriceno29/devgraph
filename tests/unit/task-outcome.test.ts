import { describe, expect, it } from 'vitest';
import { extractConventions } from '../../src/domain/work-management/task-outcome.js';

describe('extractConventions', () => {
  it('reads bullet rules under a bold or markdown heading, until the next section', () => {
    const summary =
      '**Hecho**\n- Añadí prioridad.\n\n**Decisiones**\n- validatePriority lanza RangeError.\n\n**Convenciones**\n- Toda validación lanza `RangeError` con mensaje en español.\n* Las opciones van en un objeto como último argumento.\n\n**Pendiente**\n- Nada.';
    expect(extractConventions(summary)).toEqual([
      'Toda validación lanza `RangeError` con mensaje en español.',
      'Las opciones van en un objeto como último argumento.',
    ]);
    expect(extractConventions('## Convenciones\n1. Fechas en AAAA-MM-DD.\n## Pendiente\nNada')).toEqual([
      'Fechas en AAAA-MM-DD.',
    ]);
  });
  it('accepts inline rules and ignores "Ninguna"', () => {
    expect(extractConventions('**Convenciones:** Ninguna.\n**Pendiente** nada')).toEqual([]);
    expect(extractConventions('**Convenciones**: los ids son enteros.')).toEqual(['los ids son enteros.']);
    expect(extractConventions('**Hecho** todo')).toEqual([]);
    expect(
      extractConventions(
        '**Convenciones**\n- Ninguna nueva. Esta tarea siguió las existentes: RangeError en español.\n**Pendiente** nada',
      ),
    ).toEqual([]);
  });
});
