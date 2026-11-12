import { expect, it } from 'vitest';
import { createNote } from '../src/lib/notes';

it('crea la nota con el título recortado y valores por defecto', () => {
  const result = createNote({ title: '  Hola  ' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({ title: 'Hola', body: '', tags: [], pinned: false });
});
it('guarda el cuerpo, id distinto y createdAt ISO', () => {
  const a = createNote({ title: 'A', body: 'texto' }), b = createNote({ title: 'B' });
  if (!a.ok || !b.ok) throw new Error('debían crearse');
  expect(a.value.body).toBe('texto');
  expect(a.value.id).not.toBe(b.value.id);
  expect(new Date(a.value.createdAt).toISOString()).toBe(a.value.createdAt);
});
it('convención: un título vacío devuelve ok false con mensaje, sin lanzar', () => {
  const result = createNote({ title: '   ' });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
});
