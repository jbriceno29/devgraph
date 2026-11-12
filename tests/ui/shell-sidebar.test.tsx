// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProjectTree } from '@desktop/presentation/shell/ProjectTree.js';
import { activityItem, installShellIpc } from './shell-ipc.js';
import { openShell as open, selectedTab as selected } from './helpers.js';
const root = {
  id: 'root',
  key: 'PROJ-01',
  type: 'PROJECT_ROOT' as const,
  label: 'Example Workspace',
  status: 'ACTIVE',
};
const nodes = [
  root,
  { id: 'mod', key: 'MOD-001', type: 'MODULE' as const, label: 'Catálogo', status: 'ACTIVE', parentId: 'root' },
  { id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Búsqueda', status: 'DRAFT', parentId: 'mod' },
  { id: 't2', key: 'TASK-002', type: 'WORK_ITEM' as const, label: 'Endpoint', status: 'IN_PROGRESS', parentId: 'feat' },
  { id: 't1', key: 'TASK-001', type: 'WORK_ITEM' as const, label: 'Índice', status: 'DONE', parentId: 'feat' },
  { id: 'old', key: 'TASK-009', type: 'WORK_ITEM' as const, label: 'Vieja', status: 'ARCHIVED', parentId: 'feat' },
];
const attention = {
  attentionCount: 2,
  running: [],
  items: [
    activityItem({
      id: 'a',
      kind: 'TASK_IN_REVIEW',
      title: 'TASK-002 lista para revisar',
      needsAttention: true,
      workItemId: 't2',
    }),
    activityItem({ id: 'b', kind: 'APPROVAL_PENDING', title: 'Un agente pide permiso', needsAttention: true }),
  ],
};
afterEach(cleanup);

describe('Barra lateral del shell', () => {
  it('is an accessible vertical tablist wired to its tabpanel, with arrow keys', async () => {
    installShellIpc(nodes);
    const list = await open();
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent?.replace(/(Ctrl\+|⌘)\d/, ''))).toEqual([
      'Actividad',
      'Grafo',
      'Planificar',
      'Agentes',
      'Documentos',
      'Inicio',
    ]);
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe(tabs[0]!.getAttribute('aria-controls'));
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
    expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([tabs[0]]);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowDown' });
    expect(selected()).toBe(tabs[1]);
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(selected()).toBe(tabs[5]);
    fireEvent.keyDown(tabs[5]!, { key: 'ArrowDown' });
    expect(selected()).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowUp' });
    expect(selected()).toBe(tabs[5]);
  });
  it('changes view on click and with Ctrl/⌘+number shortcuts', async () => {
    installShellIpc(nodes);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Planificar/ }));
    expect(selected().textContent).toMatch(/Planificar/);
    expect(screen.getByRole('heading', { level: 1, name: 'Planificar' })).toBeTruthy();
    fireEvent.keyDown(window, { key: '4', ctrlKey: true });
    await waitFor(() => expect(selected().textContent).toMatch(/Agentes/));
    fireEvent.keyDown(window, { key: '5', metaKey: true });
    await waitFor(() => expect(selected().textContent).toMatch(/Documentos/));
    fireEvent.keyDown(window, { key: '2' });
    expect(selected().textContent).toMatch(/Documentos/);
    expect(screen.getByRole('tab', { name: /Grafo/ }).getAttribute('aria-keyshortcuts')).toMatch(/\+2$/);
  });
  it('shows the attention count as a labelled badge on Actividad', async () => {
    installShellIpc(nodes, attention);
    await open();
    expect(await screen.findByRole('img', { name: '2 pendientes de tu atención' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: /Actividad.*2 pendientes de tu atención/ })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Un agente espera tu permiso' })).toBeTruthy();
  });
  it('lists modules › features › tasks with their status and selects the node in the graph', async () => {
    const client = installShellIpc(nodes);
    await open();
    const tree = screen.getByRole('navigation', { name: 'Árbol del proyecto' });
    const items = within(tree)
      .getAllByRole('button')
      .filter(button => !button.hasAttribute('aria-expanded'))
      .map(button => button.textContent);
    expect(items).toEqual([
      'Módulo MOD-001 Catálogo',
      'Feature FEAT-001 Búsqueda1/2, 1 de 2 tareas hechas',
      'Tarea TASK-001 Índice, estado: Hecha',
      'Tarea TASK-002 Endpoint, estado: En curso',
    ]);
    fireEvent.click(within(tree).getByRole('button', { name: /TASK-002 Endpoint/ }));
    await waitFor(() => expect(client.queries.getEntityInspectorDetails).toHaveBeenLastCalledWith('t2'));
    expect(selected().textContent).toMatch(/Grafo/);
    await waitFor(() =>
      expect(
        within(tree)
          .getByRole('button', { name: /TASK-002 Endpoint/ })
          .getAttribute('aria-current'),
      ).toBe('true'),
    );
    fireEvent.click(within(tree).getByRole('button', { name: 'Contraer FEAT-001' }));
    expect(within(tree).queryByRole('button', { name: /TASK-002/ })).toBeNull();
  });
  it('keeps project switching and the theme selector in the sidebar', async () => {
    const client = installShellIpc(nodes);
    await open();
    expect(screen.getByRole('radiogroup', { name: 'Tema de la interfaz' })).toBeTruthy();
    expect((screen.getByLabelText('Proyecto activo') as HTMLSelectElement).value).toBe('p');
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar proyectos' }));
    await waitFor(() => expect(client.queries.listProjects).toHaveBeenCalledTimes(2));
  });
  it('opens an empty project in Inicio; Actividad guides Definir → Aprobar → Ejecutar with Planificar as alternative', async () => {
    installShellIpc([root]);
    await open();
    await waitFor(() => expect(selected().textContent).toMatch(/Inicio/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inicio del proyecto' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Actividad/ }));
    const empty = await screen.findByRole('region', { name: 'Example Workspace aún no tiene features' });
    expect(
      within(empty)
        .getAllByRole('listitem')
        .map(item => item.querySelector('p')!.textContent),
    ).toEqual(['1Definir', '2Aprobar', '3Ejecutar']);
    expect(screen.queryByText('Siguiente paso')).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: 'Definir mi proyecto' }));
    await waitFor(() => expect(selected().textContent).toMatch(/Inicio/));
    fireEvent.click(screen.getByRole('tab', { name: /Actividad/ }));
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'Example Workspace aún no tiene features' })).getByRole(
        'button',
        { name: 'Prefiero describir el plan a mano' },
      ),
    );
    await waitFor(() => expect(selected().textContent).toMatch(/Planificar/));
  });
  it('badges Inicio when the inception needs an answer and opens a project with a plan in Actividad', async () => {
    installShellIpc(nodes, {
      items: [],
      running: [],
      attentionCount: 1,
      inception: {
        stage: 'ASK_GOALS',
        status: 'WAITING_USER',
        title: 'Inicio del proyecto: te falta responder',
        detail: '3 preguntas sobre el objetivo y el alcance.',
        needsAttention: true,
        changeSetId: null,
        at: 'now',
      },
    });
    await open();
    expect(selected().textContent).toMatch(/Actividad/);
    expect(await screen.findByRole('img', { name: 'Inicio del proyecto: te falta responder' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Responde las preguntas del asistente de inicio' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(selected().textContent).toMatch(/Inicio/));
  });
});

describe('buildProjectTree', () => {
  it('nests by parentId, orders by type and key and drops archived nodes', () => {
    const tree = buildProjectTree(nodes);
    expect(tree.map(item => item.node.key)).toEqual(['MOD-001']);
    expect(tree[0]!.children[0]!.children.map(item => item.node.key)).toEqual(['TASK-001', 'TASK-002']);
  });
});
