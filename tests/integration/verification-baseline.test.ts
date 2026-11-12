import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type { VerificationBaselineDto } from '../../src/shared/contracts/verification-baseline.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repository with node:test tests (no dependencies); `broken` makes one fail on main. */
async function project(broken: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'graphdev-baseline-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'test'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  writeFileSync(join(repo, 'package.json'), '{"name":"x","type":"module","scripts":{"test":"node --test"}}\n');
  writeFileSync(
    join(repo, 'test', 'sum.test.js'),
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('sum', () => assert.equal(1 + 1, ${broken ? 3 : 2}));\ntest('ok', () => {});\n`,
  );
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'T');
  git('config', 'user.email', 't@t');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'mi-rama');
  const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, {});
  cores.push(core);
  const created = (await core.handle({ channel: 'project:create', args: [{ name: 'Repo', slug: 'repo' }] })) as {
    id: string;
  };
  await core.handle({ channel: 'repository:configure', args: [created.id, repo] });
  const baseline = async (channel: string, ...args: unknown[]) =>
    (await core.handle({ channel: channel as never, args: [created.id, ...args] })) as VerificationBaselineDto;
  const finished = async () => {
    for (let i = 0; i < 200; i++) {
      const value = await baseline('baseline:get');
      if (value.status !== 'RUNNING') return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('baseline did not finish');
  };
  return { core, id: created.id, git, baseline, finished };
}

describe('verification baseline on a copy of the base branch (plan REP, R2)', () => {
  it('a broken test is reported with its counts and blocks the pilot until accepted as known', async () => {
    const { core, id, git, baseline, finished } = await project(true);
    expect((await baseline('baseline:run', ['npm test'])).status).toBe('RUNNING');
    const done = await finished();
    expect(done).toMatchObject({ status: 'DONE', ref: 'main', blocking: ['npm test'] });
    expect(done.checks[0]).toMatchObject({
      command: 'npm test',
      passed: false,
      summary: 'npm test: pasan 1, fallan 1',
    });
    expect(done.checks[0]!.tail).toContain('2 !== 3');
    // The copy came from main, not from the branch the user has open; nothing in the repository changed.
    expect(git('symbolic-ref', '--short', 'HEAD')).toBe('mi-rama');
    expect(git('status', '--porcelain')).toBe('');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
    await expect(
      core.handle({ channel: 'pilot:start', args: [id, 'feature', { acknowledgeCost: true }] }),
    ).rejects.toThrow('La verificación de la rama base falla (npm test)');
    const policy = async () =>
      (await core.handle({ channel: 'policy:get', args: [id] })) as { allowedCommands: string[] } & Record<
        string,
        unknown
      >;
    await core.handle({ channel: 'policy:update', args: [id, { ...(await policy()), allowedCommands: ['npm test'] }] });
    expect((await baseline('baseline:accept_known', ['npm test'])).blocking).toEqual([]);
    // Accepted as known: it leaves the verification, and the baseline keeps checking it.
    expect((await policy()).allowedCommands).toEqual([]);
    expect((await baseline('baseline:get')).commands).toEqual(['npm test']);
    await expect(
      core.handle({ channel: 'pilot:start', args: [id, 'feature', { acknowledgeCost: true }] }),
    ).rejects.not.toThrow('verificación de la rama base');
    await baseline('baseline:accept_known', []);
    expect((await policy()).allowedCommands).toEqual(['npm test']);
  });

  it('a green repository passes and does not block anything', async () => {
    const { baseline, finished } = await project(false);
    await baseline('baseline:run', ['npm test']);
    const done = await finished();
    expect(done).toMatchObject({ status: 'DONE', blocking: [], error: null });
    expect(done.checks[0]).toMatchObject({ passed: true, summary: 'npm test: pasan 2' });
  });
});
