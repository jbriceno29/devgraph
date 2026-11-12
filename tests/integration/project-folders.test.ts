import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type { AppSettingsDto, FolderInspectionDto } from '../../src/shared/contracts/ipc-contracts.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = (prefix: string) => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
};
const gitRepo = (path: string) => {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q', path]);
};
function setup() {
  const data = temp('graphdev2-data-'),
    home = temp('graphdev2-home-');
  const core = createWorkspaceCore(data, () => undefined, { homeDirectory: home });
  cores.push(core);
  const call = <T>(channel: string, ...args: unknown[]) =>
    core.handle({ channel: channel as never, args }) as Promise<T>;
  return { data, home, core, call };
}

describe('Carpeta de proyectos', () => {
  it('first run: no folder yet; suggests ~/Documents/repos when it already holds repositories', async () => {
    const { home, call } = setup();
    gitRepo(join(home, 'Documents', 'repos', 'tienda'));
    gitRepo(join(home, 'Documents', 'repos', 'blog'));
    mkdirSync(join(home, 'Projects'));
    const settings = await call<AppSettingsDto>('settings:get');
    expect(settings.projectsFolder).toBeNull();
    expect(settings.suggestion).toEqual({ path: join(home, 'Documents', 'repos'), exists: true, repositoryCount: 2 });
  });

  it('prefers a usual folder with repositories over an empty one, and proposes ~/Documents/repos when none exists', async () => {
    const { home, call } = setup();
    mkdirSync(join(home, 'Documents'));
    expect((await call<AppSettingsDto>('settings:get')).suggestion).toEqual({
      path: join(home, 'Documents', 'repos'),
      exists: false,
      repositoryCount: 0,
    });
    mkdirSync(join(home, 'Documents', 'repos'));
    gitRepo(join(home, 'code', 'api'));
    expect((await call<AppSettingsDto>('settings:get')).suggestion).toMatchObject({
      path: join(home, 'code'),
      repositoryCount: 1,
    });
  });

  it('saves the folder (creating it) and keeps it across restarts', async () => {
    const { data, home, call } = setup();
    const folder = join(home, 'Documents', 'repos');
    const saved = await call<AppSettingsDto>('settings:set_projects_folder', `${folder}/`);
    expect(saved.projectsFolder).toBe(folder);
    expect(existsSync(folder)).toBe(true);
    expect(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8'))).toEqual({ projectsFolder: folder });
    const again = createWorkspaceCore(data, () => undefined, { homeDirectory: home });
    cores.push(again);
    expect(((await again.handle({ channel: 'settings:get', args: [] })) as AppSettingsDto).projectsFolder).toBe(folder);
  });

  it('refuses relative paths, «..», a file, the home folder and the filesystem root', async () => {
    const { home, call } = setup();
    writeFileSync(join(home, 'file.txt'), 'x');
    await expect(call('settings:set_projects_folder', 'repos')).rejects.toThrow('debe ser absoluta');
    await expect(call('settings:set_projects_folder', `${home}/a/../b`)).rejects.toThrow('«..»');
    await expect(call('settings:set_projects_folder', join(home, 'file.txt'))).rejects.toThrow('no es una carpeta');
    await expect(call('settings:set_projects_folder', home)).rejects.toThrow('carpeta personal');
    await expect(call('settings:set_projects_folder', '/')).rejects.toThrow('carpeta personal');
    expect((await call<AppSettingsDto>('settings:get')).projectsFolder).toBeNull();
  });

  it('inspects a path: missing, empty, repository or folder with files', async () => {
    const { home, call } = setup();
    mkdirSync(join(home, 'empty'));
    gitRepo(join(home, 'repo'));
    mkdirSync(join(home, 'busy'));
    writeFileSync(join(home, 'busy', 'notes.md'), '# notas');
    expect(await call<FolderInspectionDto>('folder:inspect', join(home, 'nope'))).toEqual({
      path: join(home, 'nope'),
      exists: false,
      isDirectory: false,
      empty: false,
      isGitRepository: false,
      parentExists: true,
    });
    expect(await call<FolderInspectionDto>('folder:inspect', join(home, 'empty'))).toMatchObject({ empty: true });
    expect(await call<FolderInspectionDto>('folder:inspect', join(home, 'repo'))).toMatchObject({
      isGitRepository: true,
      empty: false,
    });
    expect(await call<FolderInspectionDto>('folder:inspect', join(home, 'busy'))).toMatchObject({
      isGitRepository: false,
      empty: false,
    });
    expect(await call<FolderInspectionDto>('folder:inspect', join(home, 'x', 'y'))).toMatchObject({
      parentExists: false,
    });
  });
});

describe('Crear un proyecto con su carpeta', () => {
  it('NEW_FOLDER: creates <folder>/<slug> with git init and a first commit, and connects it', async () => {
    const { home, call } = setup();
    const folder = join(home, 'Documents', 'repos');
    await call('settings:set_projects_folder', folder);
    const project = await call<{ id: string }>('project:create', {
      name: 'Mi tienda',
      slug: 'mi-tienda',
      location: { mode: 'NEW_FOLDER', path: join(folder, 'mi-tienda') },
    });
    const path = join(folder, 'mi-tienda');
    expect(await call('repository:get_path', project.id)).toBe(path);
    expect(existsSync(join(path, '.git'))).toBe(true);
    expect(existsSync(join(path, 'docs'))).toBe(true);
    expect(execFileSync('git', ['-C', path, 'log', '--oneline'], { encoding: 'utf8' }).trim().split('\n')).toHaveLength(
      1,
    );
  });

  it('EXISTING_REPOSITORY: connects the repository without touching its history', async () => {
    const { home, call } = setup();
    const path = join(home, 'Documents', 'repos', 'blog');
    gitRepo(path);
    writeFileSync(join(path, 'index.html'), '<h1>hola</h1>');
    const project = await call<{ id: string }>('project:create', {
      name: 'blog',
      slug: 'blog',
      location: { mode: 'EXISTING_REPOSITORY', path },
    });
    expect(await call('repository:get_path', project.id)).toBe(path);
    expect(execFileSync('git', ['-C', path, 'rev-list', '--all'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('refuses a taken folder or a folder without .git before creating anything', async () => {
    const { data, home, call } = setup();
    const folder = join(home, 'repos');
    gitRepo(join(folder, 'tienda'));
    mkdirSync(join(folder, 'notas'));
    writeFileSync(join(folder, 'notas', 'a.md'), 'x');
    await expect(
      call('project:create', {
        name: 'Tienda',
        slug: 'tienda',
        location: { mode: 'NEW_FOLDER', path: join(folder, 'tienda') },
      }),
    ).rejects.toThrow('Ya tengo el código');
    await expect(
      call('project:create', {
        name: 'Notas',
        slug: 'notas',
        location: { mode: 'NEW_FOLDER', path: join(folder, 'notas') },
      }),
    ).rejects.toThrow('ya existe y tiene archivos');
    await expect(
      call('project:create', {
        name: 'Notas',
        slug: 'notas',
        location: { mode: 'EXISTING_REPOSITORY', path: join(folder, 'notas') },
      }),
    ).rejects.toThrow('no es un repositorio Git');
    await expect(
      call('project:create', { name: 'X', slug: 'x', location: { mode: 'NEW_FOLDER', path: join(home, 'no', 'x') } }),
    ).rejects.toThrow('no existe');
    expect(await call('project:list')).toEqual([]);
    expect(existsSync(join(data, 'projects')) ? readdirSync(join(data, 'projects')) : []).toEqual([]);
  });

  it('without a location keeps working as before (repository connected later)', async () => {
    const { call } = setup();
    const project = await call<{ id: string }>('project:create', { name: 'Libre', slug: 'libre' });
    expect(await call('repository:get_path', project.id)).toBeNull();
  });
});
