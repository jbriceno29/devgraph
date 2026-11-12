// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextualInspector } from '../../src/desktop/presentation/inspector/ContextualInspector.js';
import type { EntityInspectorDto } from '../../src/shared/contracts/ipc-contracts.js';

afterEach(cleanup);
const adr = (status: string, allowedStatusChanges: string[]): EntityInspectorDto => ({
  entity: { id: 'adr', key: 'ADR-002', type: 'DECISION_RECORD', label: 'Tema claro y oscuro', status, summary: '' },
  attributes: {},
  relationships: [],
  allowedStatusChanges,
  executionHistory: [],
});
const inspector = (details: EntityInspectorDto, onChangeStatus: (status: string) => Promise<void>) =>
  render(
    <ContextualInspector
      details={details}
      contextPackage={null}
      contextLoading={false}
      contextError={null}
      onRefreshContext={vi.fn()}
      onChangeStatus={onChangeStatus}
    />,
  );

describe('decision (ADR) in the inspector', () => {
  it('a draft is accepted or rejected with a button, and says agents do not follow it yet', async () => {
    const change = vi.fn(async () => undefined);
    inspector(adr('DRAFT', ['ACCEPTED', 'REJECTED']), change);
    expect(screen.getByRole('region', { name: 'Estado de la decisión' }).textContent).toContain(
      'Los agentes aún no la reciben',
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('ACCEPTED'));
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('REJECTED'));
  });
  it('a superseded one can be reopened', () => {
    inspector(
      adr('SUPERSEDED', ['DRAFT']),
      vi.fn(async () => undefined),
    );
    expect(screen.getByRole('region', { name: 'Estado de la decisión' }).textContent).toContain(
      'Reábrela si fue un error.',
    );
    expect(screen.getByRole('button', { name: 'Volver a borrador' })).toBeTruthy();
  });
  it('an accepted one can be superseded or reopened after confirming, and shows the error of a refused change', async () => {
    const change = vi.fn(async () => {
      throw new Error('La decisión cambió mientras la editabas; vuelve a abrirla.');
    });
    inspector(adr('ACCEPTED', ['SUPERSEDED', 'DRAFT']), change);
    expect(screen.getByText('Aceptada')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver a borrador' })).toBeTruthy();
    // Leaving ACCEPTED asks first: a second click where «Aceptar» was no longer supersedes it.
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como reemplazada' }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirmar cambio' }).textContent).toContain(
      'Los agentes dejarán de seguir esta decisión.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como reemplazada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, marcar como reemplazada' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('SUPERSEDED'));
    expect((await screen.findByRole('alert')).textContent).toContain('vuelve a abrirla');
  });
});
