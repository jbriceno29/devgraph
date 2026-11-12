// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryGitForm } from '../../src/desktop/presentation/agents/RepositoryGitForm.js';
import type { RepositoryGitStatusDto } from '../../src/shared/contracts/repository-git.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const status: RepositoryGitStatusDto = {
  baseBranch: 'main',
  branches: ['desarrollo', 'graphdev/feature/feat-001-x', 'main'],
  checkedOut: 'mi-rama',
  operation: null,
  indexLocked: false,
  hasIdentity: false,
  documentsBlocked: 'Tu repositorio tiene abierta la rama mi-rama, y los documentos del proyecto viven en main.',
};
function ipc() {
  const commands = {
    getRepositoryGitStatus: vi.fn(async () => status),
    setBaseBranch: vi.fn(async (_p: string, branch: string) => ({ ...status, baseBranch: branch })),
  };
  Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
  return commands;
}

describe('Ajustes › Repositorio y ramas (plan GIT)', () => {
  it('shows the base branch, what is checked out, why documents cannot be saved and the missing identity', async () => {
    ipc();
    render(<RepositoryGitForm projectId="p" />);
    const select = (await screen.findByRole('combobox', { name: /Rama base/ })) as HTMLSelectElement;
    expect(select.value).toBe('main');
    expect([...select.options].map(option => option.value)).toEqual(['desarrollo', 'main']);
    expect(screen.getByText('mi-rama')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('No se pueden guardar documentos ahora.');
    expect(screen.getByText(/irán firmados por «Graph Workspace»/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /como rama base/ })).toBeNull();
  });

  it('changing the base branch is a draft until saved; Cancelar restores it', async () => {
    const commands = ipc();
    render(<RepositoryGitForm projectId="p" />);
    const select = (await screen.findByRole('combobox', { name: /Rama base/ })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'desarrollo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(select.value).toBe('main');
    fireEvent.change(select, { target: { value: 'desarrollo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Usar desarrollo como rama base' }));
    await waitFor(() => expect(commands.setBaseBranch).toHaveBeenCalledWith('p', 'desarrollo'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /como rama base/ })).toBeNull());
    expect(select.value).toBe('desarrollo');
  });
});
