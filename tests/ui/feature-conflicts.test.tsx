// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextualInspector } from '../../src/desktop/presentation/inspector/ContextualInspector.js';
import type { FeatureIntegrationStateDto } from '../../src/shared/contracts/agent-view.js';
import type {
  FeatureConflictsDto,
  ResolveFeatureConflictsResultDto,
} from '../../src/shared/contracts/feature-conflicts.js';
import type { EntityInspectorDto } from '../../src/shared/contracts/ipc-contracts.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const finished: FeatureIntegrationStateDto = {
  branchName: 'graphdev/feature/feat-002-prioridad',
  targetBranch: 'main',
  integratedAt: null,
  taskCount: 1,
  openTaskCount: 0,
  projectId: 'p',
  featureId: 'feat',
};
const none: FeatureConflictsDto = {
  featureId: 'feat',
  targetBranch: 'main',
  withTarget: [],
  withFeatures: [],
  unresolved: [],
};
const created: ResolveFeatureConflictsResultDto = {
  featureId: 'feat',
  workItemId: 't9',
  workItemKey: 'TASK-009',
  files: ['src/tasks.js'],
  commit: 'abc',
};
function ipc(conflicts: FeatureConflictsDto | null) {
  const commands = {
    integrateFeature: vi.fn(),
    ...(conflicts
      ? {
          checkFeatureConflicts: vi.fn(async () => conflicts),
          resolveFeatureConflicts: vi.fn(async () => created),
        }
      : {}),
  };
  Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
  return commands;
}
const inspector = (integration: FeatureIntegrationStateDto) => {
  const details: EntityInspectorDto = {
    entity: { id: 'feat', key: 'FEAT-002', type: 'FEATURE', label: 'Prioridad', status: 'DRAFT', summary: '' },
    attributes: {},
    relationships: [],
    executionHistory: [],
    integration,
  };
  return render(
    <ContextualInspector
      details={details}
      contextPackage={null}
      contextLoading={false}
      contextError={null}
      onRefreshContext={vi.fn()}
      onIntegrateFeature={vi.fn()}
    />,
  );
};

describe('conflictos de una feature antes de integrarla (F0b)', () => {
  it('a conflict with main hides «Integrar», names the files and resolves it with an agent after a confirmation', async () => {
    const commands = ipc({ ...none, withTarget: ['src/tasks.js', 'tests/tasks.test.js'] });
    inspector(finished);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('FEAT-002 choca con lo que ya está en main')).toBeTruthy();
    expect(within(alert).getByText('tests/tasks.test.js')).toBeTruthy();
    expect(commands.checkFeatureConflicts).toHaveBeenCalledWith('p', 'feat');
    expect(screen.queryByRole('button', { name: 'Integrar en main' })).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Resolver con un agente' }));
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancelar' }));
    expect(commands.resolveFeatureConflicts).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Resolver con un agente' }));
    fireEvent.click(within(alert).getByRole('button', { name: 'Sí, crear la tarea' }));
    await waitFor(() => expect(commands.resolveFeatureConflicts).toHaveBeenCalledWith('p', 'feat'));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Creé TASK-009 «Resolver conflictos con main» en FEAT-002. Ejecútala o activa el piloto; cuando la aceptes podrás integrar.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Integrar en main' })).toBeNull();
  });

  it('markers left behind (no task pending) also block integrating and offer the resolution again', async () => {
    ipc({ ...none, unresolved: ['src/tasks.js'] });
    inspector(finished);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('FEAT-002 tiene conflictos sin resolver')).toBeTruthy();
    expect(within(alert).getByRole('button', { name: 'Resolver con un agente' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Integrar en main' })).toBeNull();
  });

  it('a collision with another feature not integrated yet is a notice; «Integrar» stays', async () => {
    ipc({
      ...none,
      withFeatures: [{ featureId: 'f1', featureKey: 'FEAT-001', title: 'Tareas', files: ['src/tasks.js'] }],
    });
    inspector(finished);
    expect(await screen.findByText('También choca con FEAT-001 «Tareas», que aún no está integrada:')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Integrar en main' })).toBeTruthy();
  });

  it('without the command or the ids (older core) nothing is checked; already integrated features are not checked', async () => {
    ipc(null);
    const first = inspector(finished);
    expect(screen.getByRole('button', { name: 'Integrar en main' })).toBeTruthy();
    first.unmount();
    const commands = ipc(none);
    const { projectId: _p, featureId: _f, ...withoutIds } = finished;
    const second = inspector(withoutIds);
    second.unmount();
    inspector({ ...finished, integratedAt: '2026-11-12T00:00:00Z' });
    expect(commands.checkFeatureConflicts).not.toHaveBeenCalled();
  });
});
