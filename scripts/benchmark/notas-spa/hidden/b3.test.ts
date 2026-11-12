import { expect, it } from 'vitest';
import { filterByTag } from '../src/lib/queries';
import { note, rejected } from './helpers';

const notes = [note('Uno', { tags: ['casa'] }), note('Dos', { tags: ['trabajo', 'casa'] }), note('Tres')];

it('filtra por la etiqueta normalizada', () => {
  const result = filterByTag(notes, '  CASA ');
  if (!result.ok) throw new Error(result.error);
  expect(result.value.map(item => item.title)).toEqual(['Uno', 'Dos']);
});
it('sin coincidencias devuelve una lista vacía', () => {
  expect(filterByTag(notes, 'ocio')).toMatchObject({ ok: true, value: [] });
});
it('convención: una etiqueta vacía devuelve ok false sin lanzar', () => {
  expect(rejected(() => filterByTag(notes, ''))).toBe(true);
});
