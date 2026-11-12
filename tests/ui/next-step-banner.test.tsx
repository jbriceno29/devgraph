// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextStepBanner } from '../../src/desktop/presentation/shell/NextStepBanner.js';
import type { NextStep } from '../../src/desktop/presentation/shell/next-step.js';

afterEach(cleanup);
const step: NextStep = {
  id: 'integrate-f',
  title: 'Integra FEAT-001 «Búsqueda» en main',
  detail: 'Sus tareas están hechas.',
  actionLabel: 'Integrar FEAT-001',
  target: { view: 'graph', workItemId: 'f' },
  tone: 'success',
  action: { kind: 'integrate-feature', featureId: 'f', featureKey: 'FEAT-001', targetBranch: 'main', doneTasks: 3 },
};

describe('Banner «Siguiente paso» (B2)', () => {
  it('«Integrar FEAT-001» integrates after an inline confirmation instead of navigating', async () => {
    const onGo = vi.fn(),
      onDone = vi.fn();
    const integrate = vi.fn(async () => ({
      featureId: 'f',
      branchName: 'graphdev/feature/feat-001',
      targetBranch: 'main',
      merged: true,
      commit: 'baa9830a11',
      alreadyIntegrated: false,
    }));
    render(<NextStepBanner step={step} onGo={onGo} onIntegrateFeature={integrate} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Integrar FEAT-001' }));
    expect(screen.getByText('¿Juntar 3 tareas de FEAT-001 en main?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, integrar' }));
    expect((await screen.findByRole('status')).textContent).toBe('FEAT-001 integrada en main · commit baa9830.');
    expect(integrate).toHaveBeenCalledWith('f');
    expect(onDone).toHaveBeenCalled();
    expect(onGo).not.toHaveBeenCalled();
  });
  it('without the command, the button says it only shows the feature', () => {
    const onGo = vi.fn();
    render(<NextStepBanner step={step} onGo={onGo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver FEAT-001 para integrarla' }));
    expect(onGo).toHaveBeenCalledWith({ view: 'graph', workItemId: 'f' });
  });
  it('when integrating fails (a conflict), shows the reason and offers to open the feature to resolve it', async () => {
    const onGo = vi.fn();
    const integrate = vi.fn(async () => {
      throw new Error('FEAT-001 y main cambiaron los mismos archivos de forma distinta: src/tasks.js.');
    });
    render(<NextStepBanner step={step} onGo={onGo} onIntegrateFeature={integrate} />);
    expect(screen.queryByRole('button', { name: 'Ver FEAT-001' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Integrar FEAT-001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, integrar' }));
    expect(await screen.findByText(/cambiaron los mismos archivos de forma distinta: src\/tasks.js/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver FEAT-001' }));
    expect(onGo).toHaveBeenCalledWith({ view: 'graph', workItemId: 'f' });
  });
});
