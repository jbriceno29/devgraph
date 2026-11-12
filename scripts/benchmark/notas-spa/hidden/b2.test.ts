import { expect, it } from 'vitest';
import { sortNotes } from '../src/lib/queries';
import { note, rejected } from './helpers';

const notes = [
  note('Beta', { createdAt: '2026-01-02T00:00:00.000Z' }),
  note('álamo', { createdAt: '2026-01-03T00:00:00.000Z' }),
  note('Zeta', { createdAt: '2026-01-01T00:00:00.000Z', pinned: true }),
];
const titles = (value: unknown) => { const result = value as { ok: boolean; value: Array<{ title: string }> }; expect(result.ok).toBe(true); return result.value.map(item => item.title); };

it('recent: fijadas primero y luego de la más nueva a la más antigua', () => {
  expect(titles(sortNotes(notes, 'recent'))).toEqual(['Zeta', 'álamo', 'Beta']);
});
it('title: fijadas primero y luego alfabético en español, sin mutar la entrada', () => {
  const before = notes.map(item => item.title);
  expect(titles(sortNotes(notes, 'title'))).toEqual(['Zeta', 'álamo', 'Beta']);
  expect(notes.map(item => item.title)).toEqual(before);
});
it('convención: un criterio desconocido devuelve ok false sin lanzar', () => {
  expect(rejected(() => sortNotes(notes, 'size' as never))).toBe(true);
});
