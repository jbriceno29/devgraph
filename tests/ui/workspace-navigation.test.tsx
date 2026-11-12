// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { activityItem, installShellIpc } from './shell-ipc.js';
import { openShell as open, selectView } from './helpers.js';
const nodes = [
  { id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT' as const, label: 'Example Workspace', status: 'ACTIVE' },
  { id: 'feature', key: 'FEAT-01', type: 'FEATURE' as const, label: 'Feature work', status: 'DRAFT', parentId: 'root' },
  {
    id: 'task',
    key: 'TASK-001',
    type: 'WORK_ITEM' as const,
    label: 'Primera tarea',
    status: 'READY',
    parentId: 'feature',
  },
];
afterEach(cleanup);

it('updates navigation focus and inspector immediately when a graph node is selected', async () => {
  const client = installShellIpc(nodes);
  await open();
  await selectView(/Grafo/);
  fireEvent.click(await screen.findByRole('button', { name: 'Feature: Feature work' }));
  await waitFor(() => expect(client.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('feature'));
  // The inspector renders when the IPC answer arrives, a tick after the call: wait for it instead of reading at once.
  expect(await screen.findByRole('heading', { name: 'Feature work' })).toBeTruthy();
  expect(await screen.findByText('Summary for feature')).toBeTruthy();
});

it('opens the project on Actividad with breadcrumb, explanation and the next step', async () => {
  installShellIpc(nodes);
  await open();
  expect(screen.getByRole('tab', { name: /Actividad/ }).getAttribute('aria-selected')).toBe('true');
  expect(within(screen.getByRole('navigation', { name: 'Ruta' })).getByText('Example Workspace')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: 'Actividad' })).toBeTruthy();
  expect(screen.queryByText(/Project graph|Structured project knowledge/)).toBeNull();
  expect(await screen.findByRole('heading', { name: 'Ejecuta TASK-001 «Primera tarea» con un agente' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Ejecutar TASK-001' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /Agentes/ }).getAttribute('aria-selected')).toBe('true'));
  await waitFor(() => expect(window.workspaceIpc.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('task'));
});

it('follows inbox actions to the target view and selects the work item', async () => {
  const summary = {
    attentionCount: 1,
    running: [],
    items: [
      activityItem({
        id: 'd',
        kind: 'TASK_DONE',
        title: 'TASK-001 Primera tarea terminada',
        workItemId: 'task',
        target: 'graph',
        needsAttention: true,
      }),
    ],
  };
  installShellIpc(nodes, summary);
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver en el grafo' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /Grafo/ }).getAttribute('aria-selected')).toBe('true'));
  await waitFor(() => expect(window.workspaceIpc.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('task'));
  // The shell moves focus on the next animation frame.
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Grafo del proyecto' })),
  );
});
