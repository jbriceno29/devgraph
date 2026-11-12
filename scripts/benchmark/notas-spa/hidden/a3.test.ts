import { expect, it } from 'vitest';
import { addTag, removeTag } from '../src/lib/notes';
import { note, rejected } from './helpers';

it('addTag normaliza y no duplica, sin tocar la original', () => {
  const original = note('Uno');
  const once = addTag(original, '  Trabajo ');
  if (!once.ok) throw new Error(once.error);
  const twice = addTag(once.value, 'trabajo');
  if (!twice.ok) throw new Error(twice.error);
  expect(twice.value.tags).toEqual(['trabajo']);
  expect(original.tags).toEqual([]);
});
it('removeTag quita la etiqueta normalizada y tolera una inexistente', () => {
  const removed = removeTag(note('Uno', { tags: ['casa', 'trabajo'] }), ' CASA ');
  if (!removed.ok) throw new Error(removed.error);
  expect(removed.value.tags).toEqual(['trabajo']);
  const same = removeTag(note('Uno', { tags: ['casa'] }), 'otra');
  if (!same.ok) throw new Error(same.error);
  expect(same.value.tags).toEqual(['casa']);
});
it('convención: una etiqueta vacía devuelve ok false sin lanzar', () => {
  expect(rejected(() => addTag(note('Uno'), '   '))).toBe(true);
});
