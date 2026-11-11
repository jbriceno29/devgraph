import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { WorkspaceNavigationProvider } from '../../src/desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '../../src/desktop/state/WorkspaceShell.js';

/**
 * Deja que React termine lo pendiente: respuestas IPC simuladas que llegan un microtask después, los efectos pasivos de un
 * commit que llegó por una promesa y los `requestAnimationFrame` de foco. Úsalo tras una acción asíncrona antes de leer con `getBy*`.
 */
export async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
}

/**
 * Monta el shell completo, abre el proyecto `projectName` de la lista y espera a que esté listo: la barra de vistas visible,
 * el inspector inicial cargado y la actividad leída. Devuelve el tablist de vistas.
 */
export async function openShell(projectName = 'Example Workspace'): Promise<HTMLElement> {
  render(createElement(WorkspaceNavigationProvider, null, createElement(WorkspaceShell)));
  const project = await screen.findByRole('button', { name: new RegExp(escape(projectName)) });
  fireEvent.click(project);
  const list = await screen.findByRole('tablist', { name: 'Vistas del proyecto' });
  const ipc = window.workspaceIpc;
  await waitFor(() => expect(ipc.commands.openProject).toHaveBeenCalled());
  if (ipc.queries.getActivity) await waitFor(() => expect(ipc.queries.getActivity).toHaveBeenCalled());
  await settle();
  return list;
}

/** Elige una vista del shell con un clic en su pestaña y espera a que quede seleccionada; devuelve su panel. */
export async function selectView(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('tab', { name }));
  await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'));
  return screen.getByRole('tabpanel');
}

/** La pestaña de vista seleccionada ahora mismo. */
export const selectedTab = () => screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true')!;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
