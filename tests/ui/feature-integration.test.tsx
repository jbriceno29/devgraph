// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePilotPanel } from '../../src/desktop/presentation/agents/FeaturePilotPanel.js';
import { ContextualInspector } from '../../src/desktop/presentation/inspector/ContextualInspector.js';
import type {
  FeatureIntegrationResultDto,
  FeatureIntegrationStateDto,
  FeaturePilotDto,
} from '../../src/shared/contracts/agent-view.js';
import type { EntityInspectorDto } from '../../src/shared/contracts/ipc-contracts.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const nodes = [{ id: 'feat', key: 'FEAT-001', type: 'FEATURE' as const, label: 'Fundación', status: 'DRAFT' }];
const ready: FeatureIntegrationStateDto = {
  branchName: 'feature/feat-001-fundacion',
  targetBranch: 'main',
  integratedAt: null,
  taskCount: 2,
  openTaskCount: 0,
};
const pilot = (
  integration: FeatureIntegrationStateDto | null | undefined,
  tasks = [
    { id: 't1', displayKey: 'TASK-001', title: 'T', status: 'DONE', dependsOn: [] },
    { id: 't2', displayKey: 'TASK-002', title: 'T2', status: 'ARCHIVED', dependsOn: [] },
  ],
): FeaturePilotDto => ({
  autonomy: {
    featureId: 'feat',
    level: 'MANUAL',
    executionModel: null,
    escalationModel: null,
    maxAttempts: 3,
    usagePauseThreshold: 0.85,
    groupTasks: false,
    maxGroupSize: 3,
  },
  run: null,
  events: [],
  tasks,
  usage: null,
  running: false,
  authMode: 'subscription',
  apiKeyAvailable: false,
  availableModels: ['haiku'],
  ...(integration !== undefined ? { integration } : {}),
});
const merged: FeatureIntegrationResultDto = {
  featureId: 'feat',
  branchName: ready.branchName,
  targetBranch: 'main',
  merged: true,
  alreadyIntegrated: false,
  commit: 'abc1234def5678',
};
function ipc(
  state: FeaturePilotDto,
  integrate?: (projectId: string, featureId: string) => Promise<FeatureIntegrationResultDto>,
) {
  const value = {
    commands: {
      setFeatureAutonomy: vi.fn(),
      startPilot: vi.fn(),
      stopPilot: vi.fn(),
      resumePilot: vi.fn(),
      ...(integrate ? { integrateFeature: vi.fn(integrate) } : {}),
    },
    queries: { getFeaturePilot: vi.fn(async () => state), getFeatureReport: vi.fn() },
    events: { onPilotUpdated: vi.fn(() => () => {}) },
  };
  Object.defineProperty(window, 'workspaceIpc', { configurable: true, value });
  return value;
}
const panel = () => render(<FeaturePilotPanel projectId="p" nodes={nodes} />);

describe('«Integrar en main» in the feature pilot panel', () => {
  it('explains it, asks a simple confirmation and shows «Integrada» with the short commit', async () => {
    const client = ipc(pilot(ready), async () => merged);
    panel();
    const button = await screen.findByRole('button', { name: 'Integrar en main' });
    const group = screen.getByRole('group', { name: 'FEAT-001 está terminada' });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Junta el trabajo de la feature en main. No envía nada a ningún remoto y no toca tu carpeta si tiene cambios sin guardar.',
    );
    fireEvent.click(button);
    expect(within(group).getByText('¿Integrar FEAT-001 en main?')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Cancelar' }));
    expect(client.commands.integrateFeature).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Integrar en main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, integrar' }));
    await waitFor(() => expect(client.commands.integrateFeature).toHaveBeenCalledWith('p', 'feat'));
    expect((await screen.findByRole('status')).textContent).toBe('Integrada en main · commit abc1234.');
    await waitFor(() => expect(client.queries.getFeaturePilot).toHaveBeenCalledTimes(2));
  });

  it('«Ya estaba integrada», and the readable reason when the core refuses (dirty checkout, conflict, other worktree, pending tasks)', async () => {
    const errors = [
      'No se pudo integrar FEAT-001 en main: Tu repositorio está en main con cambios sin commitear; commitéalos o guárdalos (git stash) y vuelve a integrar.',
      'No se pudo integrar FEAT-001 en main: Conflicto al integrar en main. (src/a.js)',
      'No se pudo integrar FEAT-001 en main: La rama main está abierta en /home/ana/otro. Cambia de rama allí para poder integrar.',
      'FEAT-001 aún tiene tareas pendientes: TASK-003.',
    ];
    let call = 0;
    ipc(pilot(ready), async () => {
      call += 1;
      if (call === 1) return { ...merged, merged: false, alreadyIntegrated: true, commit: null };
      throw new Error(errors[call - 2]);
    });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Integrar en main' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, integrar' }));
    expect((await screen.findByRole('status')).textContent).toBe('Ya estaba integrada en main.');
    for (const message of errors) {
      fireEvent.click(await screen.findByRole('button', { name: 'Integrar en main' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Sí, integrar' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message));
      expect(screen.queryByRole('status')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    }
  });

  it('without the command (older core), with open tasks or without an integration branch, there is no button; an unknown base says «la rama principal»', async () => {
    ipc(pilot(ready));
    const first = panel();
    expect(await screen.findByText(/2 tareas · 0 pendientes/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Integrar/ })).toBeNull();
    first.unmount();
    for (const state of [pilot({ ...ready, openTaskCount: 1 }), pilot(null), pilot(undefined)]) {
      ipc(state, async () => merged);
      const view = panel();
      expect(await screen.findByText(/2 tareas/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Integrar/ })).toBeNull();
      view.unmount();
    }
    ipc(pilot({ ...ready, targetBranch: null, integratedAt: '2026-11-10T10:00:00Z' }), async () => merged);
    panel();
    // Already integrated (C6): it says so, and repeating it is a secondary action.
    const again = await screen.findByRole('button', { name: 'Volver a integrar en la rama principal' });
    expect(again.className).not.toContain('bg-accent');
    expect(screen.getByText('FEAT-001 está integrada en la rama principal')).toBeTruthy();
    expect(screen.getByText(/La integraste el .*puedes repetirlo sin riesgo/)).toBeTruthy();
  });
});

describe('«Integrar en main» in the inspector', () => {
  const feature = (integration?: FeatureIntegrationStateDto): EntityInspectorDto => ({
    entity: { id: 'feat', key: 'FEAT-001', type: 'FEATURE', label: 'Fundación', status: 'DRAFT', summary: '' },
    attributes: {},
    relationships: [],
    executionHistory: [],
    ...(integration ? { integration } : {}),
  });
  const inspector = (
    details: EntityInspectorDto,
    onIntegrateFeature?: (featureId: string) => Promise<FeatureIntegrationResultDto>,
    onFeatureIntegrated = vi.fn(),
  ) =>
    render(
      <ContextualInspector
        details={details}
        contextPackage={null}
        contextLoading={false}
        contextError={null}
        onRefreshContext={vi.fn()}
        {...(onIntegrateFeature ? { onIntegrateFeature } : {})}
        onFeatureIntegrated={onFeatureIntegrated}
      />,
    );
  it('shows it for a finished feature, integrates and reports back to the shell', async () => {
    const integrate = vi.fn(async () => merged),
      done = vi.fn();
    inspector(feature(ready), integrate, done);
    fireEvent.click(screen.getByRole('button', { name: 'Integrar en main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, integrar' }));
    expect((await screen.findByRole('status')).textContent).toBe('Integrada en main · commit abc1234.');
    expect(integrate).toHaveBeenCalledWith('feat');
    expect(done).toHaveBeenCalledWith(merged);
  });
  it('hides it without the command, without a branch or with open tasks', () => {
    for (const [details, integrate] of [
      [feature(ready), undefined],
      [feature(), async () => merged],
      [feature({ ...ready, openTaskCount: 2 }), async () => merged],
    ] as const) {
      const view = inspector(details, integrate);
      expect(screen.queryByRole('button', { name: /^Integrar/ })).toBeNull();
      view.unmount();
    }
  });
});
