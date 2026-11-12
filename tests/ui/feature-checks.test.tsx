// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureIntegration } from '../../src/desktop/presentation/agents/FeatureIntegration.js';
import type { FeatureIntegrationStateDto } from '../../src/shared/contracts/agent-view.js';
import type { FeatureChecksDto } from '../../src/shared/contracts/feature-checks.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const finished: FeatureIntegrationStateDto = {
  branchName: 'graphdev/feature/feat-001-base',
  targetBranch: 'main',
  integratedAt: null,
  taskCount: 1,
  openTaskCount: 0,
  projectId: 'p',
  featureId: 'f',
};
const dto = (status: FeatureChecksDto['status'], passed?: boolean): FeatureChecksDto => ({
  featureId: 'f',
  status,
  commands: ['node_modules/.bin/next build'],
  checks: passed === undefined ? [] : [{ command: 'node_modules/.bin/next build', passed, durationMs: 42_000 }],
  detail: passed === false ? 'Type error: x' : null,
  checkedAt: null,
});

describe('Integrar waits for the integration checks (plan C6)', () => {
  it('asks to check first, polls while it runs and offers «Integrar» once they passed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let current = dto('NOT_RUN');
    const commands = {
      integrateFeature: vi.fn(),
      getFeatureChecks: vi.fn(async () => current),
      runFeatureChecks: vi.fn(async () => (current = dto('RUNNING'))),
    };
    Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
    render(<FeatureIntegration featureKey="FEAT-001" state={finished} onIntegrate={async () => ({}) as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Comprobar antes de integrar' }));
    expect(await screen.findByText(/puede tardar unos minutos/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Integrar en main' })).toBeNull();
    current = dto('PASSED', true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Integrar en main' })).toBeTruthy());
    expect(screen.getByText('Las comprobaciones de integración pasaron')).toBeTruthy();
    expect(screen.getByText(/42 s/)).toBeTruthy();
  });

  it('a failure shows the output and keeps «Integrar» hidden', async () => {
    const commands = { integrateFeature: vi.fn(), getFeatureChecks: vi.fn(async () => dto('FAILED', false)) };
    Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
    render(<FeatureIntegration featureKey="FEAT-001" state={finished} onIntegrate={async () => ({}) as never} />);
    expect(await screen.findByText('Type error: x')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver a comprobar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Integrar en main' })).toBeNull();
  });
});
