import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchBox } from '../src/components/SearchBox';

afterEach(cleanup);

it('es un campo de búsqueda con la etiqueta «Buscar notas» que muestra value', () => {
  render(createElement(SearchBox, { value: 'café', onChange: () => undefined }));
  const input = screen.getByRole('searchbox', { name: 'Buscar notas' }) as HTMLInputElement;
  expect(input.value).toBe('café');
});
it('llama a onChange con el texto nuevo', () => {
  const onChange = vi.fn();
  render(createElement(SearchBox, { value: '', onChange }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar notas' }), { target: { value: 'pan' } });
  expect(onChange).toHaveBeenCalledWith('pan');
});
