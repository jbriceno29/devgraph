import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('muestra el título de la aplicación', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Notas rápidas' })).toBeTruthy();
});
