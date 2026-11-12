// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDocsForm } from '../../src/desktop/presentation/agents/ProjectDocsForm.js';
import type { ProjectDocsDto, ProjectDocsInput } from '../../src/shared/contracts/project-docs.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const docs: ProjectDocsDto = {
  enabled: true,
  domains: ['developer.mozilla.org', 'www.npmjs.com', 'react.dev'],
  stackDomains: ['developer.mozilla.org', 'www.npmjs.com', 'react.dev'],
  extraDomains: [],
};
function ipc() {
  const commands = {
    getProjectDocs: vi.fn(async () => docs),
    setProjectDocs: vi.fn(async (_p: string, input: ProjectDocsInput) => ({
      ...docs,
      enabled: input.enabled,
      extraDomains: input.extraDomains,
    })),
  };
  Object.defineProperty(window, 'workspaceIpc', { configurable: true, value: { commands, queries: {}, events: {} } });
  return commands;
}

describe('Ajustes › Documentación en línea (plan C1)', () => {
  it('shows the stack domains; added domains are a draft until saved and Cancelar restores them', async () => {
    const commands = ipc();
    render(<ProjectDocsForm projectId="p" />);
    expect(await screen.findByText('developer.mozilla.org, www.npmjs.com, react.dev')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar la documentación' })).toBeNull();
    const area = screen.getByRole('textbox', { name: /Otros dominios/ }) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'orm.drizzle.team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(area.value).toBe('');
    fireEvent.change(area, { target: { value: 'orm.drizzle.team\nnextjs.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar la documentación' }));
    await waitFor(() =>
      expect(commands.setProjectDocs).toHaveBeenCalledWith('p', {
        enabled: true,
        extraDomains: ['orm.drizzle.team', 'nextjs.org'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar la documentación' })).toBeNull());
  });

  it('turning it off hides the domains and saves enabled: false', async () => {
    const commands = ipc();
    render(<ProjectDocsForm projectId="p" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /pueden leer documentación actual/ }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar la documentación' }));
    await waitFor(() =>
      expect(commands.setProjectDocs).toHaveBeenCalledWith('p', { enabled: false, extraDomains: [] }),
    );
  });
});
