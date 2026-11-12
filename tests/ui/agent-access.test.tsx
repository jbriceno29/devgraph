// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentAccessSection } from '../../src/desktop/presentation/inception/AgentAccessSection.js';
import { ExecutionPolicyForm } from '../../src/desktop/presentation/agents/ExecutionPolicyForm.js';
import type { AgentAccessDto, AgentAccessEditDto } from '../../src/shared/contracts/repository-scan.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'workspaceIpc');
});
const access: AgentAccessDto = {
  writable: [
    { pattern: 'app/**', reason: 'CODE' },
    { pattern: 'lib/**', reason: 'CODE' },
    { pattern: 'next.config.mjs', reason: 'CONFIG' },
  ],
  verificationCommands: ['npm test', 'npm run lint'],
  edited: false,
};
function Editable({ onEdit }: { onEdit(edit: AgentAccessEditDto | null): void }) {
  const [edit, setEdit] = useState<AgentAccessEditDto | null>(null);
  return (
    <AgentAccessSection
      access={access}
      edit={edit}
      onChange={next => {
        setEdit(next);
        onEdit(next);
      }}
    />
  );
}

describe('«Qué podrá tocar el agente» (plan REP, R1)', () => {
  it('lists the paths with why, and lets the user remove, add and restore them', () => {
    const onEdit = vi.fn();
    render(<Editable onEdit={onEdit} />);
    const list = screen.getByRole('list', { name: 'Rutas que puede escribir el agente' });
    expect(within(list).getByText('app/**').parentElement!.textContent).toContain('código y recursos');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar lib/**' }));
    expect(onEdit).toHaveBeenLastCalledWith({
      writablePaths: ['app/**', 'next.config.mjs'],
      verificationCommands: ['npm test', 'npm run lint'],
    });
    fireEvent.change(screen.getByLabelText('Añadir una ruta'), { target: { value: './server/**' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(within(list).getByText('server/**').parentElement!.textContent).toContain('añadida por ti');
    fireEvent.change(screen.getByLabelText(/Una por línea/), { target: { value: 'npm test' } });
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ verificationCommands: ['npm test'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lo que se detectó' }));
    expect(onEdit).toHaveBeenLastCalledWith(null);
    expect(within(list).getByText('lib/**')).toBeTruthy();
  });
  it('read-only once sent, and warns when the repository has no checks', () => {
    render(<AgentAccessSection access={{ ...access, verificationCommands: [] }} />);
    expect(screen.queryByRole('button', { name: /Quitar/ })).toBeNull();
    expect(screen.getByText(/sin comprobaciones nada se acepta solo/)).toBeTruthy();
  });
  it('Ajustes › Política: «Proponer rutas desde el repositorio» fills the form without saving', async () => {
    const updateExecutionPolicy = vi.fn();
    Object.defineProperty(window, 'workspaceIpc', {
      configurable: true,
      value: {
        commands: { updateExecutionPolicy },
        queries: {
          getExecutionPolicy: vi.fn(async () => ({
            writablePaths: ['src/**'],
            readonlyPaths: [],
            deniedPaths: ['.env*'],
            allowedCommands: [],
          })),
          proposeAccessFromRepository: vi.fn(async () => ({
            writable: [
              { pattern: 'app/**', reason: 'CODE' },
              { pattern: 'package.json', reason: 'CONFIG' },
            ],
            verificationCommands: ['npm test'],
          })),
        },
      },
    });
    render(<ExecutionPolicyForm projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Proponer rutas desde el repositorio' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Rutas escribibles') as HTMLTextAreaElement).value).toBe('app/**\npackage.json'),
    );
    expect((screen.getByLabelText('Comandos de verificación') as HTMLTextAreaElement).value).toBe('npm test');
    expect(screen.getByRole('status').textContent).toMatch(/Revísalas y guarda/);
    expect(updateExecutionPolicy).not.toHaveBeenCalled();
  });
});
