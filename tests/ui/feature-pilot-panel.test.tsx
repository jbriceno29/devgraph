// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePilotPanel } from '../../src/desktop/presentation/agents/FeaturePilotPanel.js';
import { EngineAuthForm } from '../../src/desktop/presentation/agents/EngineAuthForm.js';
import type { FeaturePilotDto } from '../../src/shared/contracts/agent-view.js';

afterEach(cleanup);
const nodes = [
  { id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Gestión de tareas', status: 'DRAFT' },
  { id: 't1', key: 'TASK-001', type: 'WORK_ITEM' as const, label: 'T', status: 'READY' },
];
const base: FeaturePilotDto = {
  autonomy: {
    featureId: 'feat',
    level: 'PILOT',
    executionModel: 'haiku',
    escalationModel: 'sonnet',
    maxAttempts: 3,
    usagePauseThreshold: 0.85,
    groupTasks: false,
    maxGroupSize: 3,
  },
  run: null,
  events: [],
  tasks: [
    { id: 't1', displayKey: 'TASK-001', title: 'T', status: 'READY', dependsOn: [] },
    { id: 't2', displayKey: 'TASK-002', title: 'T2', status: 'DONE', dependsOn: [] },
  ],
  usage: { utilization: 0.42, window: 'five_hour', resetsAt: null, status: 'allowed' },
  running: false,
  authMode: 'subscription',
  apiKeyAvailable: false,
  availableModels: ['haiku', 'sonnet', 'opus'],
};
function ipc(state: FeaturePilotDto = base) {
  const value = {
    commands: {
      setFeatureAutonomy: vi.fn(async (_p: string, _f: string, input: { level: string }) => ({
        ...state.autonomy,
        ...input,
      })),
      startPilot: vi.fn(async () => ({
        id: 'run',
        featureId: 'feat',
        status: 'RUNNING',
        reason: null,
        startedAt: 'now',
        endedAt: null,
      })),
      stopPilot: vi.fn(async () => null),
      resumePilot: vi.fn(async () => null),
      setAuthMode: vi.fn(async () => ({ authMode: 'api_key' })),
    },
    queries: { getFeaturePilot: vi.fn(async () => state) },
    events: { onPilotUpdated: vi.fn(() => () => {}) },
  };
  Object.defineProperty(window, 'workspaceIpc', { configurable: true, value });
  return value;
}

describe('FeaturePilotPanel', () => {
  it('saves the autonomy level and its settings for the selected feature', async () => {
    const client = ipc({ ...base, autonomy: { ...base.autonomy, level: 'MANUAL' } });
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    fireEvent.click(await screen.findByLabelText(/Auto-aceptar/));
    fireEvent.change(screen.getByLabelText('Modelo de ejecución'), { target: { value: 'haiku' } });
    fireEvent.change(screen.getByLabelText('Intentos por tarea'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar autonomía' }));
    await waitFor(() =>
      expect(client.commands.setFeatureAutonomy).toHaveBeenCalledWith('p', 'feat', {
        level: 'AUTO_ACCEPT',
        executionModel: 'haiku',
        escalationModel: 'sonnet',
        maxAttempts: 2,
        usagePauseThreshold: 0.85,
        groupTasks: false,
        maxGroupSize: 3,
        reviewModel: null,
      }),
    );
  });

  it('offers task grouping only for the pilot level, saves the switch and the size, and previews «~M ejecuciones» in the cost warning', async () => {
    const client = ipc();
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    const grouping = await screen.findByLabelText(/Agrupar tareas pequeñas/);
    fireEvent.click(grouping);
    fireEvent.change(screen.getByLabelText('Tareas por ejecución (máximo)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar autonomía' }));
    await waitFor(() =>
      expect(client.commands.setFeatureAutonomy).toHaveBeenCalledWith(
        'p',
        'feat',
        expect.objectContaining({ level: 'PILOT', groupTasks: true, maxGroupSize: 2 }),
      ),
    );
    fireEvent.click(screen.getByLabelText(/Manual/));
    expect(screen.queryByLabelText(/Agrupar tareas pequeñas/)).toBeNull();
    cleanup();

    // Three READY tasks, grouping on (size 3) and a DONE task elsewhere in the project: one grouped execution instead of three.
    const tasks = [
      { id: 't1', displayKey: 'TASK-001', title: 'A', status: 'READY', dependsOn: [], summary: '', criteriaCount: 2 },
      { id: 't2', displayKey: 'TASK-002', title: 'B', status: 'READY', dependsOn: [], summary: '', criteriaCount: 2 },
      { id: 't3', displayKey: 'TASK-003', title: 'C', status: 'READY', dependsOn: [], summary: '', criteriaCount: 2 },
    ];
    ipc({ ...base, autonomy: { ...base.autonomy, groupTasks: true, maxGroupSize: 3 }, tasks });
    render(
      <FeaturePilotPanel
        projectId="p"
        nodes={[...nodes, { id: 't0', key: 'TASK-000', type: 'WORK_ITEM' as const, label: 'Hecha', status: 'DONE' }]}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar piloto' }));
    const warning = screen.getByRole('group', { name: 'Aviso de costo' });
    expect(warning.textContent).toContain(
      'Quedan 3 tareas en esta feature, en ~1 ejecución (agrupando hasta 3 tareas pequeñas por ejecución)',
    );
  });

  it('shows the cost warning and starts only after it is acknowledged', async () => {
    const client = ipc();
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar piloto' }));
    const warning = screen.getByRole('group', { name: 'Aviso de costo' });
    expect(warning.textContent).toContain('Quedan 1 tareas');
    expect(warning.textContent).toContain('42 % de la ventana de 5 h');
    expect(warning.textContent).toContain('se pausará al llegar al 85 %');
    const start = screen.getByRole('button', { name: 'Iniciar' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Entiendo el costo/));
    fireEvent.click(start);
    await waitFor(() =>
      expect(client.commands.startPilot).toHaveBeenCalledWith('p', 'feat', { acknowledgeCost: true }),
    );
  });

  it('lets the user stop a running pilot, and resume one that waits, showing why', async () => {
    const running = ipc({
      ...base,
      run: { id: 'run', featureId: 'feat', status: 'RUNNING', reason: null, startedAt: 'now', endedAt: null },
      events: [
        {
          id: 'e1',
          sequenceNo: 1,
          kind: 'TASK_STARTED',
          message: 'TASK-001: intento 1 de 3 con haiku.',
          workItemId: 't1',
          executionId: null,
          createdAt: '2026-11-10T10:00:00Z',
        },
      ],
    });
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    expect(await screen.findByText(/TASK-001: intento 1 de 3 con haiku/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detener piloto' }));
    await waitFor(() => expect(running.commands.stopPilot).toHaveBeenCalledWith('p', 'feat'));
    cleanup();
    const waiting = ipc({
      ...base,
      run: {
        id: 'run',
        featureId: 'feat',
        status: 'WAITING_USER',
        reason: 'TASK-001 falló 3 veces.',
        startedAt: 'now',
        endedAt: null,
      },
    });
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    expect((await screen.findByRole('status')).textContent).toBe('Esperándote · TASK-001 falló 3 veces.');
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar piloto' }));
    await waitFor(() => expect(waiting.commands.resumePilot).toHaveBeenCalledWith('p', 'feat'));
  });

  it('labels plan changes and proposals in the decision log', async () => {
    ipc({
      ...base,
      run: { id: 'run', featureId: 'feat', status: 'RUNNING', reason: null, startedAt: 'now', endedAt: null },
      events: [
        {
          id: 'e1',
          sequenceNo: 1,
          kind: 'PLAN_CHANGED',
          message: 'Plan modificado al cerrar TASK-001: Validación.',
          workItemId: 't1',
          executionId: null,
          createdAt: '2026-11-10T10:00:00Z',
        },
        {
          id: 'e2',
          sequenceNo: 2,
          kind: 'PLAN_PROPOSAL',
          message: 'Propuesta de TASK-001 pendiente.',
          workItemId: 't1',
          executionId: null,
          createdAt: '2026-11-10T10:01:00Z',
        },
      ],
    });
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    const log = await screen.findByRole('list', { name: 'Decisiones del piloto' });
    expect(log.textContent).toContain('Plan modificado');
    expect(log.textContent).toContain('Propuesta de cambios');
    expect(log.textContent).not.toContain('PLAN CHANGED');
  });

  it('only offers the API key when the app was started with one (in Ajustes, not in the pilot)', async () => {
    const client = ipc();
    render(<FeaturePilotPanel projectId="p" nodes={nodes} />);
    await screen.findByRole('button', { name: 'Iniciar piloto' });
    expect(screen.queryByLabelText('Autenticación del motor')).toBeNull();
    cleanup();
    render(<EngineAuthForm projectId="p" nodes={nodes} />);
    const option = (await screen.findByRole('option', { name: /Clave de API/ })) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain('ANTHROPIC_API_KEY');
    fireEvent.change(screen.getByLabelText('Autenticación del motor'), { target: { value: 'api_key' } });
    await waitFor(() => expect(client.commands.setAuthMode).toHaveBeenCalledWith('p', 'api_key'));
  });

  it('lets the user see and change the engine authentication in a project with no features yet', async () => {
    const client = ipc();
    const getProviderAuth = vi.fn(async () => ({ authMode: 'subscription' as const, apiKeyAvailable: true }));
    (client.queries as Record<string, unknown>).getProviderAuth = getProviderAuth;
    render(<EngineAuthForm projectId="p" nodes={[]} />);
    const select = (await screen.findByLabelText('Autenticación del motor')) as HTMLSelectElement;
    expect(getProviderAuth).toHaveBeenCalledWith('p');
    expect(client.queries.getFeaturePilot).not.toHaveBeenCalled();
    expect(select.value).toBe('subscription');
    fireEvent.change(select, { target: { value: 'api_key' } });
    await waitFor(() => expect(client.commands.setAuthMode).toHaveBeenCalledWith('p', 'api_key'));
  });
});
