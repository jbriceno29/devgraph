import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepositoryGitStatusDto } from '../../src/shared/contracts/repository-git.js';
import { setup, twoFeatures } from './feature-branches-fixture.js';

/** Plan GIT: the app never writes on what the user has checked out, nor mixes the user's commits into its branches. */
describe('Git seguro (plan GIT)', () => {
  const createDocument = (core: Awaited<ReturnType<typeof setup>>['core'], projectId: string, rootId: string) =>
    core.handle({
      channel: 'artifact:create',
      args: [{ projectId, entityType: 'ARTIFACT', title: 'Requisitos', artifactType: 'PRD', targetEntityId: rootId }],
    }) as Promise<{ document: { id: string; contentHash: string }; content: string }>;

  it('G1: a feature starts from and integrates into the base branch, whatever branch the user has open', async () => {
    const { git, repo, runAndAccept, integrate, files } = await setup(twoFeatures([]));
    git('checkout', '--quiet', '-b', 'mi-trabajo');
    writeFileSync(join(repo, 'personal.txt'), 'mío\n');
    git('add', 'personal.txt');
    git('commit', '--quiet', '-m', 'trabajo personal');
    const mine = git('rev-parse', 'mi-trabajo').trim();

    const accepted = await runAndAccept('a1');
    expect(accepted.execution.baseBranch).toBe('graphdev/feature/feat-001-fundacion');
    expect(files('graphdev/feature/feat-001-fundacion')).toEqual(['README.md', 'src/a.js']);
    await expect(integrate('fa')).resolves.toMatchObject({ merged: true, targetBranch: 'main' });
    expect(files('main')).toEqual(['README.md', 'src/a.js']);
    // The user's branch and checkout are exactly as they left them.
    expect(git('rev-parse', 'mi-trabajo').trim()).toBe(mine);
    expect(git('symbolic-ref', '--short', 'HEAD').trim()).toBe('mi-trabajo');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('G2: a feature receives only the documents of the base branch, never other commits', async () => {
    const more = { id: 'a2', key: 'TASK-003', feature: 'fa', title: 'Más de a', summary: 'WRITE src/a2.js :: x' };
    const { core, projectId, rootId, git, repo, runAndAccept, files } = await setup(twoFeatures([], [more]));
    await runAndAccept('a1');
    await createDocument(core, projectId, rootId);
    writeFileSync(join(repo, 'otro.txt'), 'cambio del usuario en main\n');
    git('add', 'otro.txt');
    git('commit', '--quiet', '-m', 'cambio del usuario');
    // The second task of the feature finds the document in its branch; the user's other commit stays out.
    await runAndAccept('a2');
    const branch = 'graphdev/feature/feat-001-fundacion';
    expect(files(branch)).toContain('docs/PRD.md');
    expect(files(branch)).not.toContain('otro.txt');
    expect(git('log', '--format=%s', `main..${branch}`)).toContain(
      'Actualiza graphdev/feature/feat-001-fundacion con los documentos de main',
    );
    expect(git('log', '--format=%s', branch)).not.toContain('cambio del usuario');
  });

  it('G3 and G7: documents are saved only on the base branch, with no git operation half done', async () => {
    const { core, projectId, rootId, git, repo } = await setup(twoFeatures([]));
    git('checkout', '--quiet', '-b', 'otra');
    await expect(createDocument(core, projectId, rootId)).rejects.toThrow(
      'Tu repositorio tiene abierta la rama otra, y los documentos del proyecto viven en main. Cambia a main',
    );
    expect(git('log', '--oneline', 'otra').trim().split('\n')).toHaveLength(1);
    expect(existsSync(join(repo, 'docs', 'PRD.md'))).toBe(false);

    git('checkout', '--quiet', 'main');
    const lock = join(repo, '.git', 'index.lock');
    writeFileSync(lock, '');
    await expect(createDocument(core, projectId, rootId)).rejects.toThrow(/Git está ocupado en tu repositorio/);
    execFileSync('rm', [lock]);

    // A merge stopped on a conflict.
    git('checkout', '--quiet', '-b', 'lado');
    writeFileSync(join(repo, 'README.md'), '# lado\n');
    git('commit', '--quiet', '-am', 'lado');
    git('checkout', '--quiet', 'main');
    writeFileSync(join(repo, 'README.md'), '# main\n');
    git('commit', '--quiet', '-am', 'main');
    expect(() => git('merge', '--quiet', 'lado')).toThrow();
    await expect(createDocument(core, projectId, rootId)).rejects.toThrow(
      'Tu repositorio está a mitad de un merge. Termínalo o cancélalo (git merge --abort)',
    );
    git('merge', '--abort');
    await expect(createDocument(core, projectId, rootId)).resolves.toMatchObject({ document: expect.anything() });
    expect(git('log', '-1', '--format=%s', 'main').trim()).toBe('docs(graph): DOC-001 Requisitos');
  });

  it('G9 and G10: opening the project removes merge worktrees a crash left; the base branch is detected and editable', async () => {
    const { core, projectId, git, workspaceRoot } = await setup(twoFeatures([]));
    const orphan = join(workspaceRoot, 'projects', projectId, 'merges', '11111111-1111-4111-8111-111111111111');
    mkdirSync(join(orphan, '..'), { recursive: true });
    git('worktree', 'add', '--quiet', '--detach', orphan, 'main');
    await core.handle({ channel: 'project:open', args: [projectId] });
    expect(existsSync(orphan)).toBe(false);
    expect(git('worktree', 'list', '--porcelain')).not.toContain(orphan);

    const status = (await core.handle({
      channel: 'repository:git_status',
      args: [projectId],
    })) as RepositoryGitStatusDto;
    expect(status).toMatchObject({ baseBranch: 'main', checkedOut: 'main', operation: null, documentsBlocked: null });
    git('branch', 'desarrollo');
    await expect(
      core.handle({ channel: 'repository:set_base_branch', args: [projectId, 'no-existe'] }),
    ).rejects.toThrow('La rama no-existe no existe en el repositorio.');
    const changed = (await core.handle({
      channel: 'repository:set_base_branch',
      args: [projectId, 'desarrollo'],
    })) as RepositoryGitStatusDto;
    expect(changed.baseBranch).toBe('desarrollo');
    expect(changed.documentsBlocked).toMatch(/viven en desarrollo/);
  });
});
