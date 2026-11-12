import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NoteList } from '../src/components/NoteList';
import { note } from './helpers';

afterEach(cleanup);

it('muestra un botón por nota con su título dentro de una lista', () => {
  render(createElement(NoteList, { notes: [note('Uno'), note('Dos')], onSelect: () => undefined }));
  expect(screen.getByRole('list')).toBeTruthy();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Uno' })).toBeTruthy();
});
it('pulsar el botón llama a onSelect con el id', () => {
  const onSelect = vi.fn(), first = note('Uno');
  render(createElement(NoteList, { notes: [first], onSelect }));
  fireEvent.click(screen.getByRole('button', { name: 'Uno' }));
  expect(onSelect).toHaveBeenCalledWith(first.id);
});
it('sin notas muestra «No hay notas»', () => {
  render(createElement(NoteList, { notes: [], onSelect: () => undefined }));
  expect(screen.getByText('No hay notas')).toBeTruthy();
  expect(screen.queryByRole('list')).toBeNull();
});
