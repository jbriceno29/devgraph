import { expect, it } from 'vitest';
import { searchNotes } from '../src/lib/queries';
import { note } from './helpers';

const notes = [note('Café de la mañana'), note('Lista', { body: 'Comprar CAFÉ y pan' }), note('Otra cosa')];
const titles = (value: unknown) => { const result = value as { ok: boolean; value: Array<{ title: string }> }; expect(result.ok).toBe(true); return result.value.map(item => item.title); };

it('busca en título y cuerpo sin distinguir mayúsculas ni acentos', () => {
  expect(titles(searchNotes(notes, 'cafe'))).toEqual(['Café de la mañana', 'Lista']);
});
it('un texto vacío devuelve todas', () => {
  expect(titles(searchNotes(notes, '  '))).toHaveLength(3);
});
it('convención: devuelve un resultado ok con la lista', () => {
  expect(searchNotes(notes, 'otra')).toMatchObject({ ok: true });
});
