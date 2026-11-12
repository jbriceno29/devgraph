import { expect, it } from 'vitest';
import { parseNotes, serializeNotes } from '../src/lib/exchange';
import { note, rejected } from './helpers';

const notes = [note('Uno', { tags: ['casa'], pinned: true }), note('Dos', { body: 'b' })];

it('serializeNotes y parseNotes son inversos, con version 1', () => {
  const text = serializeNotes(notes);
  if (!text.ok) throw new Error(text.error);
  expect(JSON.parse(text.value).version).toBe(1);
  expect(parseNotes(text.value)).toEqual({ ok: true, value: notes });
});
it('convención: JSON mal formado devuelve ok false sin lanzar', () => {
  expect(rejected(() => parseNotes('{ no es json'))).toBe(true);
});
it('convención: versión distinta o nota inválida devuelven ok false', () => {
  expect(rejected(() => parseNotes(JSON.stringify({ version: 2, notes })))).toBe(true);
  expect(rejected(() => parseNotes(JSON.stringify({ version: 1, notes: [{ ...notes[0], pinned: 'sí' }] })))).toBe(true);
  const { title: _title, ...untitled } = notes[0]!;
  expect(rejected(() => parseNotes(JSON.stringify({ version: 1, notes: [untitled] })))).toBe(true);
});
