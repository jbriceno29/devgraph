import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import type {
  FeatureConflictsDto,
  ResolveFeatureConflictsResultDto,
} from '../../src/shared/contracts/feature-conflicts.js';
import { setup, type Spec } from './feature-branches-fixture.js';

/** The todo-app case of the F0 validation: two features with no dependency create the same file in parallel. */
const sameFile = (): Spec => ({
  features: [
    { id: 'fa', key: 'FEAT-001', title: 'Tareas' },
    { id: 'fb', key: 'FEAT-002', title: 'Prioridad' },
  ],
  tasks: [
    {
      id: 'a1',
      key: 'TASK-001',
      feature: 'fa',
      title: 'Crear tareas',
      summary: 'WRITE src/tasks.js :: createTaskList',
    },
    { id: 'b1', key: 'TASK-002', feature: 'fb', title: 'Prioridad', summary: 'WRITE src/tasks.js :: crearTarea' },
  ],
  edges: [],
});

describe('conflictos entre features (plan UX, F0b)', () => {
  it('warns before integrating, explains the conflict and resolves it with a task of the feature', async () => {
    const { core, projectId, git, runAndAccept, integrate, withDb, mergeWorktrees } = await setup(sameFile());
    const check = (featureId: string) =>
      core.handle({ channel: 'feature:check_conflicts', args: [projectId, featureId] }) as Promise<FeatureConflictsDto>;
    await runAndAccept('a1');
    await runAndAccept('b1');

    // Before either is integrated: the collision between the two features is visible on both sides.
    expect(await check('fb')).toMatchObject({
      targetBranch: 'main',
      withTarget: [],
      withFeatures: [{ featureId: 'fa', featureKey: 'FEAT-001', files: ['src/tasks.js'] }],
      unresolved: [],
    });
    await integrate('fa');
    const main = git('rev-parse', 'main').trim();
    expect(await check('fb')).toMatchObject({ withTarget: ['src/tasks.js'], withFeatures: [], unresolved: [] });

    // Integrating says which files collide and what to do; main is untouched and no merge worktree is left.
    await expect(integrate('fb')).rejects.toThrow(
      'FEAT-002 y main cambiaron los mismos archivos de forma distinta: src/tasks.js. main no se tocó. Pulsa «Resolver con un agente» en FEAT-002',
    );
    expect(git('rev-parse', 'main').trim()).toBe(main);
    expect(mergeWorktrees()).toEqual([]);

    const resolved = (await core.handle({
      channel: 'feature:resolve_conflicts',
      args: [projectId, 'fb'],
    })) as ResolveFeatureConflictsResultDto;
    expect(resolved).toMatchObject({ featureId: 'fb', files: ['src/tasks.js'], commit: expect.any(String) });
    const branch = 'feature/feat-002-prioridad';
    expect(git('show', `${branch}:src/tasks.js`)).toMatch(/<<<<<<< [\s\S]*=======[\s\S]*>>>>>>> /);
    expect(git('merge-base', '--is-ancestor', 'main', branch)).toBe('');
    expect(mergeWorktrees()).toEqual([]);
    const task = withDb(
      db =>
        db
          .prepare('SELECT title,summary,status,parent_id FROM knowledge_entities WHERE id=?')
          .get(resolved.workItemId) as { title: string; summary: string; status: string; parent_id: string },
    );
    expect(task).toMatchObject({ title: 'Resolver conflictos con main', status: 'READY', parent_id: 'fb' });
    expect(task.summary).toContain('src/tasks.js');

    // While the resolution is pending the feature cannot be integrated; the check reports the markers.
    await expect(integrate('fb')).rejects.toThrow(/marcadores de conflicto en src\/tasks.js/);
    expect(await check('fb')).toMatchObject({ withTarget: [], unresolved: ['src/tasks.js'] });

    // The fake engine resolves it (it writes what the summary says); then the feature integrates cleanly.
    withDb(db =>
      db
        .prepare('UPDATE knowledge_entities SET summary=? WHERE id=?')
        .run(`${task.summary}\nWRITE src/tasks.js :: createTaskList con prioridad`, resolved.workItemId),
    );
    await runAndAccept(resolved.workItemId);
    expect(await check('fb')).toMatchObject({ withTarget: [], unresolved: [] });
    await expect(integrate('fb')).resolves.toMatchObject({ merged: true, targetBranch: 'main' });
    expect(git('show', 'main:src/tasks.js').trim()).toBe('createTaskList con prioridad');
  });

  it('refuses to resolve a feature with pending tasks or without conflicts', async () => {
    const { core, projectId, runAndAccept, integrate } = await setup(sameFile());
    const resolve = (featureId: string) =>
      core.handle({ channel: 'feature:resolve_conflicts', args: [projectId, featureId] });
    await runAndAccept('a1');
    await expect(resolve('fb')).rejects.toThrow(/no tiene rama de integración/);
    await integrate('fa');
    await expect(resolve('fa')).rejects.toThrow(/no hubo conflictos/);
  });

  it('refuses to move a feature branch the user has checked out, naming the folder', async () => {
    const { core, projectId, repo, git, runAndAccept, integrate } = await setup(sameFile());
    await runAndAccept('a1');
    await runAndAccept('b1');
    await integrate('fa');
    const branch = 'feature/feat-002-prioridad';
    const tip = git('rev-parse', branch).trim();
    git('checkout', '--quiet', branch);
    await expect(core.handle({ channel: 'feature:resolve_conflicts', args: [projectId, 'fb'] })).rejects.toThrow(
      `Tu repositorio (${realpathSync(repo)}) tiene abierta la rama ${branch}. Cambia a otra rama`,
    );
    expect(git('rev-parse', branch).trim()).toBe(tip);
    git('checkout', '--quiet', 'main');
    await expect(core.handle({ channel: 'feature:resolve_conflicts', args: [projectId, 'fb'] })).resolves.toMatchObject(
      {
        files: ['src/tasks.js'],
      },
    );
  });
});
