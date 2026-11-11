import { describe, expect, it } from 'vitest';
import { splitSummaryByTask } from '../../src/domain/work-management/task-outcome.js';

describe('splitSummaryByTask', () => {
  it('splits by markdown headings, bold keys or «Parte n de m» lines, keeping the preamble with the first section', () => {
    const summary = 'Resumen general.\n\n## TASK-001 Crear\n**Hecho** a\n\n**TASK-002**\n**Hecho** b\n\nParte 3 de 3: TASK-003\n**Hecho** c';
    const sections = splitSummaryByTask(summary, ['TASK-001', 'TASK-002', 'TASK-003'])!;
    expect(sections.get('TASK-001')).toBe('Resumen general.\n\n## TASK-001 Crear\n**Hecho** a');
    expect(sections.get('TASK-002')).toBe('**TASK-002**\n**Hecho** b');
    expect(sections.get('TASK-003')).toBe('Parte 3 de 3: TASK-003\n**Hecho** c');
  });

  it('returns null when a key has no heading, and does not match a key mentioned mid-sentence or a longer key', () => {
    expect(splitSummaryByTask('## TASK-001\nhecho. Ver TASK-002 después.', ['TASK-001', 'TASK-002'])).toBeNull();
    expect(splitSummaryByTask('## TASK-0010\nx\n## TASK-002\ny', ['TASK-001', 'TASK-002'])).toBeNull();
  });

  it('accepts sections in any order', () => {
    const sections = splitSummaryByTask('## TASK-002\nb\n## TASK-001\na', ['TASK-001', 'TASK-002'])!;
    expect(sections.get('TASK-001')).toBe('## TASK-001\na');
    expect(sections.get('TASK-002')).toBe('## TASK-002\nb');
  });
});
