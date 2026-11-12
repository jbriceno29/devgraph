// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installShellIpc } from './shell-ipc.js';
import { openShell as open, selectedTab as selected } from './helpers.js';

const nodes = [
  { id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT' as const, label: 'Example Workspace', status: 'ACTIVE' },
  { id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Búsqueda', status: 'DRAFT', parentId: 'root' },
];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Cambios sin guardar al cambiar de vista (B4)', () => {
  it('asks before leaving Planificar with a written request, and stays when the user cancels', async () => {
    installShellIpc(nodes);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Planificar/ }));
    fireEvent.change(await screen.findByLabelText('¿Qué quieres cambiar?'), { target: { value: 'Añade login' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('tab', { name: /Grafo/ }));
    expect(confirm).toHaveBeenCalledWith(
      'Tienes cambios sin guardar en «¿Qué quieres cambiar?». ¿Salir y descartarlos?',
    );
    expect(selected().textContent).toMatch(/Planificar/);
    expect((screen.getByLabelText('¿Qué quieres cambiar?') as HTMLTextAreaElement).value).toBe('Añade login');
    confirm.mockReturnValue(true);
    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(selected().textContent).toMatch(/Grafo/);
  });
  it('switches without asking when nothing is unsaved', async () => {
    installShellIpc(nodes);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Planificar/ }));
    await screen.findByLabelText('¿Qué quieres cambiar?');
    const confirm = vi.spyOn(window, 'confirm');
    fireEvent.click(screen.getByRole('tab', { name: /Grafo/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(selected().textContent).toMatch(/Grafo/);
  });
});
