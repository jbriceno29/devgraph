// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installShellIpc } from './shell-ipc.js';
import { openShell as open } from './helpers.js';

const nodes = [
  { id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT' as const, label: 'Example Workspace', status: 'ACTIVE' },
  { id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Búsqueda', status: 'DRAFT', parentId: 'root' },
  { id: 't1', key: 'TASK-001', type: 'WORK_ITEM' as const, label: 'Índice', status: 'READY', parentId: 'feat' },
];
afterEach(cleanup);

describe('Filtro del grafo (B1)', () => {
  it('hides tasks only on the canvas: the tree keeps them and the core is not asked for a filtered graph', async () => {
    const ipc = installShellIpc(nodes);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Grafo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tarea' }));
    expect(screen.queryByLabelText('Tarea: Índice')).toBeNull();
    const tree = screen.getByRole('navigation', { name: 'Árbol del proyecto' });
    expect(within(tree).getByText(/Índice/)).toBeTruthy();
    expect(ipc.queries.getGraphView).not.toHaveBeenCalledWith('p', expect.anything());
  });
  it('keeps the filter after switching to another view and back', async () => {
    installShellIpc(nodes);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Grafo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tarea' }));
    fireEvent.click(screen.getByRole('tab', { name: /Documentos/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Grafo/ }));
    expect(screen.queryByLabelText('Tarea: Índice')).toBeNull();
    expect(screen.getByRole('button', { name: 'Filtros · 1 ocultos' })).toBeTruthy();
  });
});
