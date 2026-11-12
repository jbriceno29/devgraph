// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphCanvas } from '../../src/desktop/presentation/graph/GraphCanvas.js';

afterEach(cleanup);
it('renders proposed graph nodes as accessible, dashed ghosts before application', () => {
  render(
    <GraphCanvas
      nodes={[{ id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT', label: 'Workspace', status: 'ACTIVE' }]}
      edges={[]}
      ghostNodes={[
        { id: '$feature', key: 'NEW-1', type: 'FEATURE', label: 'Member sign in', status: 'GHOST', parentId: 'root' },
      ]}
      ghostEdges={[
        { id: 'ghost-edge-1', source: 'root', target: '$feature', type: 'DOCUMENTED_BY', provenance: 'CHANGESET' },
      ]}
      selectedId="root"
      onSelect={() => undefined}
      onFilter={() => undefined}
    />,
  );
  expect(screen.getByLabelText('Propuesta: Feature: Member sign in')).toBeTruthy();
  expect(screen.getByText('Propuesta · documentado en')).toBeTruthy();
});

describe('living graph (Stage 6)', () => {
  const nodes = [
    { id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT' as const, label: 'Workspace', status: 'ACTIVE' },
    { id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Tareas', status: 'DRAFT', parentId: 'root' },
    { id: 't1', key: 'TASK-001', type: 'WORK_ITEM' as const, label: 'Crear', status: 'DONE', parentId: 'feat' },
    { id: 't2', key: 'TASK-002', type: 'WORK_ITEM' as const, label: 'Listar', status: 'IN_PROGRESS', parentId: 'feat' },
    { id: 't3', key: 'TASK-003', type: 'WORK_ITEM' as const, label: 'Contar', status: 'BLOCKED', parentId: 'feat' },
  ];
  afterEach(() => {
    delete (window as { workspaceIpc?: unknown }).workspaceIpc;
  });
  it('colors tasks by live status, counts feature progress and shows the autopilot badge', async () => {
    let emit: (event: { projectId: string; featureId: string; status: string | null }) => void = () => undefined;
    (window as unknown as { workspaceIpc: unknown }).workspaceIpc = {
      events: {
        onPilotUpdated: (listener: typeof emit) => {
          emit = listener;
          return () => undefined;
        },
      },
      queries: { getContextFlow: vi.fn() },
    };
    render(
      <GraphCanvas
        projectId="p1"
        nodes={nodes}
        edges={[]}
        selectedId="root"
        onSelect={() => undefined}
        onFilter={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Tarea: Listar').getAttribute('data-live')).toBe('true');
    expect(screen.getByText('EN CURSO')).toBeTruthy();
    expect(screen.getByText('✓ HECHA')).toBeTruthy();
    expect(screen.getByText('BLOQUEADA')).toBeTruthy();
    expect(screen.getByText(/1\/3 tareas/)).toBeTruthy();
    act(() => emit({ projectId: 'other', featureId: 'feat', status: 'RUNNING' }));
    expect(screen.queryByText('PILOTO')).toBeNull();
    act(() => emit({ projectId: 'p1', featureId: 'feat', status: 'RUNNING' }));
    expect(screen.getByText('PILOTO')).toBeTruthy();
    act(() => emit({ projectId: 'p1', featureId: 'feat', status: 'COMPLETED' }));
    expect(screen.queryByText('PILOTO')).toBeNull();
  });
  it('draws the context that reached the selected task, by authority tier, and lets the user hide it', async () => {
    const getContextFlow = vi.fn(async () => ({
      executionId: 'e1',
      snapshotId: 's1',
      sources: [
        { entityId: 't1', tier: 5, origin: 'GRAPH' },
        { entityId: 'feat', tier: 3, origin: 'GRAPH' },
      ],
      conventions: ['convention:TASK-001:1'],
    }));
    (window as unknown as { workspaceIpc: unknown }).workspaceIpc = {
      events: { onPilotUpdated: () => () => undefined },
      queries: { getContextFlow },
    };
    const { container } = render(
      <GraphCanvas
        projectId="p1"
        nodes={nodes}
        edges={[]}
        selectedId="t2"
        onSelect={() => undefined}
        onFilter={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Tarea: Crear').getAttribute('data-context-tier')).toBe('5'));
    expect(getContextFlow).toHaveBeenCalledWith('p1', 't2');
    expect(screen.getByLabelText('Feature: Tareas').getAttribute('data-context-tier')).toBe('3');
    expect(container.querySelectorAll('[data-context-flow]')).toHaveLength(2);
    expect(screen.getByLabelText('Leyenda del contexto').textContent).toContain('1 convenciones');
    fireEvent.click(screen.getByRole('button', { name: /Ocultar contexto · 2/ }));
    expect(container.querySelectorAll('[data-context-flow]')).toHaveLength(0);
    expect(screen.getByLabelText('Tarea: Crear').getAttribute('data-context-tier')).toBeNull();
  });
  it('asks for no context when the selection is not a task or the bridge is missing', () => {
    render(
      <GraphCanvas
        projectId="p1"
        nodes={nodes}
        edges={[]}
        selectedId="t2"
        onSelect={() => undefined}
        onFilter={() => undefined}
      />,
    );
    expect(screen.getByText('EN CURSO')).toBeTruthy();
  });
});

describe('lienzo navegable', () => {
  const nodes = [
    { id: 'root', key: 'PROJ-01', type: 'PROJECT_ROOT' as const, label: 'Workspace', status: 'ACTIVE' },
    {
      id: 'a',
      key: 'TASK-001',
      type: 'WORK_ITEM' as const,
      label: 'Crear el índice de búsqueda de texto completo para productos',
      status: 'READY',
      parentId: 'root',
    },
    { id: 'b', key: 'TASK-002', type: 'WORK_ITEM' as const, label: 'Listar', status: 'DRAFT', parentId: 'root' },
  ];
  const edges = [{ id: 'e', source: 'a', target: 'b', type: 'DEPENDS_ON' as const, provenance: 'USER' as const }];
  const zoom = (container: HTMLElement) => Number(container.querySelector('svg[data-zoom]')!.getAttribute('data-zoom'));
  it('zooms with accessible buttons and fits the graph to the view', () => {
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        selectedId={null}
        onSelect={() => undefined}
        onFilter={() => undefined}
      />,
    );
    expect(screen.getByRole('toolbar', { name: 'Zoom del grafo' }).textContent).toContain('100 %');
    fireEvent.click(screen.getByRole('button', { name: 'Acercar' }));
    expect(zoom(container)).toBe(1.2);
    fireEvent.click(screen.getByRole('button', { name: 'Alejar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alejar' }));
    expect(zoom(container)).toBe(0.83);
    const viewport = screen.getByRole('region', { name: /Lienzo del grafo/ });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 });
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar a la vista' }));
    const width = Number(container.querySelector('svg')!.getAttribute('width'));
    expect(width).toBeLessThanOrEqual(300);
    expect(zoom(container)).toBeLessThan(0.83);
    fireEvent.keyDown(viewport, { key: '+' });
    expect(screen.getByRole('toolbar').textContent).toMatch(/\d+ %/);
  });
  it('zooms with Ctrl + wheel but leaves the plain wheel to scroll', () => {
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        selectedId={null}
        onSelect={() => undefined}
        onFilter={() => undefined}
      />,
    );
    const viewport = screen.getByRole('region', { name: /Lienzo del grafo/ });
    fireEvent.wheel(viewport, { deltaY: -100 });
    expect(zoom(container)).toBe(1);
    fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true });
    expect(zoom(container)).toBe(1.1);
  });
  it('names relations in Spanish only while an end is selected or hovered, and wraps long titles in two lines', () => {
    const { container, rerender } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        selectedId={null}
        onSelect={() => undefined}
        onFilter={() => undefined}
      />,
    );
    expect(screen.queryByText('depende de')).toBeNull();
    expect(container.textContent).not.toContain('DEPENDS');
    fireEvent.mouseEnter(screen.getByLabelText('Tarea: Listar'));
    expect(screen.getByText('depende de')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByLabelText('Tarea: Listar'));
    expect(screen.queryByText('depende de')).toBeNull();
    rerender(
      <GraphCanvas nodes={nodes} edges={edges} selectedId="a" onSelect={() => undefined} onFilter={() => undefined} />,
    );
    expect(screen.getByText('depende de')).toBeTruthy();
    const title = [...screen.getByLabelText(/Tarea: Crear el índice/).querySelectorAll('tspan')].map(
      span => span.textContent,
    );
    expect(title).toEqual(['Crear el índice de', 'búsqueda de texto…']);
  });
  it('shows readable filters and counts only what is hidden', () => {
    const onFilter = vi.fn();
    render(
      <GraphCanvas nodes={nodes} edges={edges} selectedId={null} onSelect={() => undefined} onFilter={onFilter} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Depende de' }));
    expect(onFilter).toHaveBeenLastCalledWith(expect.any(Array), expect.not.arrayContaining(['DEPENDS_ON']));
    expect(screen.getByRole('button', { name: 'Cerrar filtros · 1 ocultos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tarea' }).getAttribute('aria-pressed')).toBe('true');
  });
});
