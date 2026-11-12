// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectSetup } from '../../src/desktop/state/project-create-form.js';
import { WorkspaceNavigationProvider } from '../../src/desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '../../src/desktop/state/WorkspaceShell.js';
import type { AppSettingsDto, FolderInspectionDto } from '../../src/shared/contracts/ipc-contracts.js';
import { installShellIpc } from './shell-ipc.js';

afterEach(cleanup);

const REPOS = '/home/ana/Documents/repos';
const suggestion = { path: REPOS, exists: true, repositoryCount: 7 };
const folder = (path: string, over: Partial<FolderInspectionDto> = {}): FolderInspectionDto => ({
  path,
  exists: false,
  isDirectory: false,
  empty: false,
  isGitRepository: false,
  parentExists: true,
  ...over,
});

/** The shell fake plus the settings, folder inspection and picker of the projects folder. */
function install({
  projectsFolder = null,
  inspect = (path: string) => folder(path),
  picker,
}: {
  projectsFolder?: string | null;
  inspect?: (path: string) => FolderInspectionDto;
  picker?: () => Promise<string | null>;
} = {}) {
  const ipc = installShellIpc([]);
  let settings: AppSettingsDto = { projectsFolder, suggestion };
  ipc.queries.getAppSettings = vi.fn(async () => settings);
  ipc.commands.setProjectsFolder = vi.fn(async (path: string) => {
    settings = { ...settings, projectsFolder: path };
    return settings;
  });
  ipc.queries.inspectFolder = vi.fn(async (path: string) => inspect(path));
  if (picker) ipc.platform = { pickFolder: vi.fn(picker) };
  return ipc;
}

describe('Primera vez: carpeta de proyectos', () => {
  it('asks where the projects live, proposing the folder that already holds repositories, then creates in <folder>/<slug>', async () => {
    const ipc = install();
    const onCreate = vi.fn(async () => {});
    render(<ProjectSetup onCreate={onCreate} disabled={false} />);
    expect(await screen.findByRole('heading', { name: '¿En qué carpeta guardas tus proyectos?' })).toBeTruthy();
    expect((screen.getByLabelText('Carpeta de proyectos') as HTMLInputElement).value).toBe(REPOS);
    expect(screen.getByText('Te la proponemos porque ya tiene 7 repositorios.')).toBeTruthy();
    expect(screen.getByText(`${REPOS}/mi-tienda`)).toBeTruthy();
    // Without a native picker (tests, browser) there is no «Elegir…»: the path is typed.
    expect(screen.queryByRole('button', { name: 'Elegir…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Usar esta carpeta' }));
    await waitFor(() => expect(ipc.commands.setProjectsFolder).toHaveBeenCalledWith(REPOS));

    fireEvent.change(await screen.findByLabelText('Nombre del proyecto'), { target: { value: 'Mi App' } });
    expect(screen.getByText('Paso 2 de 2 · Tu primer proyecto')).toBeTruthy();
    expect(await screen.findByText(/Carpeta nueva: la app hace/)).toBeTruthy();
    expect(screen.getByText(`${REPOS}/mi-app`)).toBeTruthy();
    expect(ipc.queries.inspectFolder).toHaveBeenCalledWith(`${REPOS}/mi-app`);
    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Mi App',
        slug: 'mi-app',
        location: { mode: 'NEW_FOLDER', path: `${REPOS}/mi-app` },
      }),
    );
  });

  it('the folder can be chosen with the system picker and changed later', async () => {
    const ipc = install({ picker: async () => '/home/ana/code' });
    render(<ProjectSetup onCreate={vi.fn()} disabled={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir…' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Carpeta de proyectos') as HTMLInputElement).value).toBe('/home/ana/code'),
    );
    expect(ipc.platform!.pickFolder).toHaveBeenCalledWith({
      title: 'Carpeta donde guardas tus proyectos',
      defaultPath: REPOS,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Usar esta carpeta' }));
    expect(await screen.findByText('/home/ana/code')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByRole('heading', { name: '¿En qué carpeta guardas tus proyectos?' })).toBeTruthy();
    expect(screen.queryByText(/Paso 1 de 2/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByLabelText('Nombre del proyecto')).toBeTruthy();
  });

  it('shows why the core refused the folder', async () => {
    const ipc = install();
    ipc.commands.setProjectsFolder = vi.fn(async () => {
      throw new Error('La app no puede escribir en «/srv». Elige otra carpeta.');
    });
    render(<ProjectSetup onCreate={vi.fn()} disabled={false} />);
    fireEvent.change(await screen.findByLabelText('Carpeta de proyectos'), { target: { value: '/srv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Usar esta carpeta' }));
    expect((await screen.findByRole('alert')).textContent).toContain('no puede escribir');
  });
});

describe('Crear un proyecto en la carpeta de proyectos', () => {
  it('a name already used by a repository: says so and offers to use it as the project code', async () => {
    install({
      projectsFolder: REPOS,
      inspect: path =>
        path.endsWith('/tienda')
          ? folder(path, { exists: true, isDirectory: true, isGitRepository: true })
          : folder(path),
    });
    const onCreate = vi.fn(async () => {});
    render(<ProjectSetup onCreate={onCreate} disabled={false} />);
    fireEvent.change(await screen.findByLabelText('Nombre del proyecto'), { target: { value: 'Tienda' } });
    expect(await screen.findByText('Ya existe un repositorio con ese nombre en tu carpeta de proyectos.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Crear proyecto' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Es el código de este proyecto: usarlo' }));
    expect((screen.getByLabelText('Carpeta del repositorio') as HTMLInputElement).value).toBe(`${REPOS}/tienda`);
    const create = await screen.findByRole('button', { name: 'Crear proyecto con este código' });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(create);
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Tienda',
        slug: 'tienda',
        location: { mode: 'EXISTING_REPOSITORY', path: `${REPOS}/tienda` },
      }),
    );
  });

  it('a folder with files that is not a repository blocks the name', async () => {
    install({
      projectsFolder: REPOS,
      inspect: path => folder(path, { exists: true, isDirectory: true }),
    });
    render(<ProjectSetup onCreate={vi.fn()} disabled={false} />);
    fireEvent.change(await screen.findByLabelText('Nombre del proyecto'), { target: { value: 'notas' } });
    expect(
      await screen.findByText('Ya existe una carpeta con ese nombre y tiene archivos. Usa otro nombre.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Es el código de este proyecto: usarlo' })).toBeNull();
  });

  it('«Ya tengo el código»: the picked repository names the project; a folder without .git is refused', async () => {
    const picks = ['/home/ana/trabajo/sin-git', '/home/ana/trabajo/api-pagos'];
    install({
      projectsFolder: REPOS,
      picker: async () => picks.shift() ?? null,
      inspect: path => folder(path, { exists: true, isDirectory: true, isGitRepository: path.endsWith('api-pagos') }),
    });
    const onCreate = vi.fn(async () => {});
    render(<ProjectSetup onCreate={onCreate} disabled={false} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Ya tengo el código' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir…' }));
    expect(await screen.findByText(/no es un repositorio Git/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir…' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Nombre del proyecto') as HTMLInputElement).value).toBe('api-pagos'),
    );
    await waitFor(() => expect(screen.queryByText(/no es un repositorio Git/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto con este código' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'api-pagos',
        slug: 'api-pagos',
        location: { mode: 'EXISTING_REPOSITORY', path: '/home/ana/trabajo/api-pagos' },
      }),
    );
  });

  it('in the shell: the core error stays next to the form and the project list is untouched', async () => {
    const ipc = install({ projectsFolder: REPOS });
    ipc.commands.createProject = vi.fn(async () => {
      throw new Error('La carpeta «/home/ana/Documents/repos/mi-app» ya existe y tiene archivos. Usa otro nombre.');
    });
    render(
      <WorkspaceNavigationProvider>
        <WorkspaceShell />
      </WorkspaceNavigationProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Nombre del proyecto'), { target: { value: 'Mi app' } });
    await screen.findByText(/Carpeta nueva/);
    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await waitFor(() => expect(ipc.commands.createProject).toHaveBeenCalled());
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain('ya existe y tiene archivos');
    expect(screen.getByLabelText('Nombre del proyecto')).toBeTruthy();
  });
});
