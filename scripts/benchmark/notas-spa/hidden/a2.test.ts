import { expect, it } from 'vitest';
import { updateNote } from '../src/lib/notes';
import { note, rejected } from './helpers';

it('aplica title, body y pinned conservando id y createdAt', () => {
  const original = note('Uno');
  const result = updateNote(original, { title: ' Dos ', body: 'b', pinned: true });
  if (!result.ok) throw new Error(result.error);
  expect(result.value).toMatchObject({ id: original.id, createdAt: original.createdAt, title: 'Dos', body: 'b', pinned: true });
});
it('no modifica la nota original', () => {
  const original = note('Uno');
  updateNote(original, { title: 'Otro' });
  expect(original.title).toBe('Uno');
});
it('convención: un título vacío devuelve ok false sin lanzar', () => {
  expect(rejected(() => updateNote(note('Uno'), { title: '  ' }))).toBe(true);
});
