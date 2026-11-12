// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerificationBaselinePanel } from '../../src/desktop/presentation/agents/VerificationBaselinePanel.js';
import type { VerificationBaselineDto } from '../../src/shared/contracts/verification-baseline.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const base = { ranAt: null, ref: null, checks: [], knownFailing: [], blocking: [], error: null };
const failing: VerificationBaselineDto = {
  ...base,
  status: 'DONE',
  commands: ['npm test'],
  ref: 'main',
  checks: [{ command: 'npm test', passed: false, tail: 'expected 2', summary: 'npm test: pasan 4, fallan 1' }],
  blocking: ['npm test'],
};

describe('Cómo está la verificación hoy (plan REP, R2)', () => {
  it('runs by itself in the inception and shows the failure with the way out', async () => {
    const commands = {
      getVerificationBaseline: vi.fn(async () => ({ ...base, status: 'NOT_RUN' as const, commands: ['npm test'] })),
      runVerificationBaseline: vi.fn(async () => failing),
      acceptKnownFailures: vi.fn(async () => ({ ...failing, knownFailing: ['npm test'], blocking: [] })),
    };
    Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
    render(<VerificationBaselinePanel projectId="p" commands={['npm test']} autoRun />);
    expect(await screen.findByText('npm test: pasan 4, fallan 1')).toBeTruthy();
    expect(commands.runVerificationBaseline).toHaveBeenCalledWith('p', ['npm test']);
    expect(screen.getByRole('alert').textContent).toContain('«Dejar la verificación en verde»');
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar estos fallos como conocidos' }));
    await waitFor(() => expect(commands.acceptKnownFailures).toHaveBeenCalledWith('p', ['npm test']));
    expect(await screen.findByRole('button', { name: 'Dejar de aceptarlos' })).toBeTruthy();
  });

  it('in Ajustes it does not run by itself, and edited checks ask to check again', async () => {
    const commands = {
      getVerificationBaseline: vi.fn(async () => failing),
      runVerificationBaseline: vi.fn(),
    };
    Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
    render(<VerificationBaselinePanel projectId="p" commands={['npm test', 'npm run lint']} />);
    expect(await screen.findByText('Cambiaste las comprobaciones: vuelve a comprobarlas.')).toBeTruthy();
    expect(commands.runVerificationBaseline).not.toHaveBeenCalled();
  });
});
