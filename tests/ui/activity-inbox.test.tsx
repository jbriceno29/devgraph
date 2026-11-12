// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityInbox, relativeTime } from '../../src/desktop/presentation/shell/ActivityInbox.js';
import { notifyAttention, resetNotifiedForTests } from '../../src/desktop/platform/notifications.js';
import type { ActivityItemDto, ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';

afterEach(() => {
  cleanup();
  resetNotifiedForTests();
  Reflect.deleteProperty(window, 'workspaceIpc');
  vi.unstubAllGlobals();
});
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const item = (over: Partial<ActivityItemDto> & Pick<ActivityItemDto, 'id' | 'kind' | 'title'>): ActivityItemDto => ({
  at: ago(5),
  detail: null,
  needsAttention: false,
  workItemId: null,
  executionId: null,
  featureId: null,
  changeSetId: null,
  target: 'agents',
  ...over,
});
const full: ActivitySummaryDto = {
  attentionCount: 2,
  running: [{ workItemKey: 'TASK-002', title: 'Listar tareas' }],
  items: [
    item({
      id: 'p1',
      kind: 'PLAN_PROPOSAL',
      title: 'Propuesta de cambios al plan: Validación',
      detail: 'Acéptala o recházala en Planificación.',
      needsAttention: true,
      changeSetId: 'cs',
      workItemId: 't1',
      executionId: 'e1',
      target: 'planning',
    }),
    item({
      id: 'r1',
      kind: 'TASK_IN_REVIEW',
      title: 'TASK-004 Exportar lista para revisar',
      needsAttention: true,
      workItemId: 't4',
      executionId: 'e4',
    }),
    item({
      id: 'run1',
      kind: 'TASK_RUNNING',
      title: 'TASK-002 Listar tareas en curso',
      workItemId: 't2',
      executionId: 'e2',
    }),
    item({
      id: 'd1',
      kind: 'TASK_DONE',
      title: 'TASK-001 Crear tareas terminada',
      workItemId: 't1',
      target: 'graph',
      at: ago(130),
    }),
  ],
};
type Listener = (event: Record<string, unknown>) => void;
function ipc(...responses: ActivitySummaryDto[]) {
  const listeners: Record<string, Listener[]> = { graph: [], execution: [], pilot: [] };
  const stops = vi.fn();
  const on = (key: string) =>
    vi.fn((listener: Listener) => {
      listeners[key]!.push(listener);
      return stops;
    });
  const queue = [...responses];
  const value = {
    queries: { getActivity: vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0]!)) },
    events: {
      onGraphRevisionUpdated: on('graph'),
      onExecutionStatusChanged: on('execution'),
      onPilotUpdated: on('pilot'),
    },
  };
  Object.defineProperty(window, 'workspaceIpc', { configurable: true, value });
  return { value, listeners, stops };
}

describe('ActivityInbox', () => {
  it('groups what needs the user, what runs and what happened, with real action buttons', async () => {
    const { value } = ipc(full);
    render(<ActivityInbox projectId="p" onNavigate={() => undefined} />);
    const region = await screen.findByRole('region', { name: 'Actividad del proyecto' });
    await within(region).findByText('Propuesta de cambios al plan: Validación');
    expect(value.queries.getActivity).toHaveBeenCalledWith('p');
    const attention = screen.getByRole('region', { name: /Requiere tu atención/ });
    expect(within(attention).getAllByRole('listitem')).toHaveLength(2);
    expect(within(attention).getByRole('button', { name: 'Ver propuesta' })).toBeTruthy();
    expect(within(attention).getByRole('button', { name: 'Revisar' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: /En curso/ })).getByText('TASK-002 Listar tareas en curso'),
    ).toBeTruthy();
    const recent = screen.getByRole('region', { name: /Reciente/ });
    expect(within(recent).getByText('hace 2 h')).toBeTruthy();
    expect(within(recent).getByRole('button', { name: 'Ver en el grafo' })).toBeTruthy();
  });

  it('sends the user to the right place for each item', async () => {
    ipc(full);
    const onNavigate = vi.fn();
    render(<ActivityInbox projectId="p" onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver propuesta' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      view: 'planning',
      workItemId: 't1',
      executionId: 'e1',
      changeSetId: 'cs',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      view: 'agents',
      workItemId: 't4',
      executionId: 'e4',
      changeSetId: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ver en el grafo' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      view: 'graph',
      workItemId: 't1',
      executionId: null,
      changeSetId: null,
    });
  });

  it('shows a helpful empty state and refreshes on core events, cleaning up its subscriptions', async () => {
    const { value, listeners, stops } = ipc({ items: [], running: [], attentionCount: 0 }, full);
    const view = render(<ActivityInbox projectId="p" onNavigate={() => undefined} />);
    expect(await screen.findByText('Todo al día. Cuando haya tareas listas o en curso las verás aquí.')).toBeTruthy();
    act(() => {
      for (const listener of listeners.graph!) listener({ projectId: 'otro', revision: 2 });
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(value.queries.getActivity).toHaveBeenCalledTimes(1);
    act(() => {
      for (const listener of listeners.pilot!) listener({ projectId: 'p', featureId: 'feat', status: 'WAITING_USER' });
    });
    expect(await screen.findByText('Propuesta de cambios al plan: Validación')).toBeTruthy();
    expect(value.queries.getActivity).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(stops).toHaveBeenCalledTimes(3);
  });

  it('uses the summary it receives instead of asking the core again', async () => {
    const { value } = ipc(full);
    const onNavigate = vi.fn();
    const view = render(<ActivityInbox projectId="p" onNavigate={onNavigate} summary={null} />);
    expect(screen.getByText('Cargando actividad…')).toBeTruthy();
    view.rerender(<ActivityInbox projectId="p" onNavigate={onNavigate} summary={full} loading={false} error={null} />);
    expect(screen.getByText('Propuesta de cambios al plan: Validación')).toBeTruthy();
    view.rerender(
      <ActivityInbox projectId="p" onNavigate={onNavigate} summary={full} loading={false} error="sin base de datos" />,
    );
    expect(screen.getByRole('alert').textContent).toContain('sin base de datos');
    expect(value.queries.getActivity).not.toHaveBeenCalled();
  });

  it('works without the workspace bridge', async () => {
    render(<ActivityInbox projectId="p" onNavigate={() => undefined} />);
    expect(await screen.findByText(/Todo al día/)).toBeTruthy();
  });

  it('shows the error when the activity cannot be read', async () => {
    Object.defineProperty(window, 'workspaceIpc', {
      configurable: true,
      value: {
        queries: {
          getActivity: vi.fn(async () => {
            throw new Error('sin base de datos');
          }),
        },
        events: {},
      },
    });
    render(<ActivityInbox projectId="p" onNavigate={() => undefined} />);
    expect((await screen.findByRole('alert')).textContent).toContain('sin base de datos');
  });
});

describe('desktop notices', () => {
  it('notifies only new items needing attention, only in the background, once', async () => {
    const created: Array<{ title: string; body: string | undefined }> = [];
    const Fake = Object.assign(
      function (this: unknown, title: string, options?: { body?: string }) {
        created.push({ title, body: options?.body });
      } as unknown as typeof Notification,
      {
        permission: 'default' as NotificationPermission,
        requestPermission: vi.fn(async () => {
          (Fake as { permission: NotificationPermission }).permission = 'granted';
          return 'granted' as NotificationPermission;
        }),
      },
    );
    vi.stubGlobal('Notification', Fake);
    const old = item({ id: 'old', kind: 'PLAN_PROPOSAL', title: 'Vieja', needsAttention: true });
    expect(await notifyAttention([old], { windowFocused: false })).toBe(0);
    const fresh = item({
      id: 'new',
      kind: 'PILOT_WAITING',
      title: 'El piloto de FEAT-001 espera tu decisión',
      detail: 'Revisa la propuesta.',
      needsAttention: true,
    });
    const calm = item({ id: 'calm', kind: 'TASK_DONE', title: 'Hecha' });
    expect(await notifyAttention([old, fresh, calm], { windowFocused: true })).toBe(0);
    const another = item({
      id: 'other',
      kind: 'APPROVAL_PENDING',
      title: 'Un agente pide permiso',
      needsAttention: true,
    });
    expect(await notifyAttention([old, fresh, another], { windowFocused: false })).toBe(1);
    expect(created).toEqual([{ title: 'Un agente pide permiso', body: 'Ábrelo en la bandeja de actividad.' }]);
    expect(Fake.requestPermission).toHaveBeenCalledTimes(1);
    expect(await notifyAttention([another], { windowFocused: false })).toBe(0);
  });

  it('never throws when the webview has no Notification or it fails', async () => {
    vi.stubGlobal('Notification', undefined);
    await notifyAttention([], { windowFocused: false });
    expect(
      await notifyAttention([item({ id: 'x', kind: 'PLAN_PROPOSAL', title: 'x', needsAttention: true })], {
        windowFocused: false,
      }),
    ).toBe(0);
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function () {
          throw new Error('no');
        },
        { permission: 'granted' },
      ),
    );
    expect(
      await notifyAttention([item({ id: 'y', kind: 'PLAN_PROPOSAL', title: 'y', needsAttention: true })], {
        windowFocused: false,
      }),
    ).toBe(0);
    expect(relativeTime('no es fecha')).toBe('');
  });
});
