import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitFeatureChecks } from '../../src/modules/execution/infrastructure/feature-checks.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const projectId = '11111111-2222-4333-8444-555555555555';

/** main has app.js; the feature adds feature.js. check.js passes only when both files are there (the merged result). */
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'graphdev-checks-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'T');
  git('config', 'user.email', 't@t');
  writeFileSync(join(repo, 'app.js'), 'export const app = 1;\n');
  writeFileSync(
    join(repo, 'check.js'),
    "const fs = require('node:fs');\nif (!fs.existsSync('feature.js') || !fs.existsSync('app.js')) { console.error('missing file'); process.exit(1); }\nconsole.log('build ok');\n",
  );
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'graphdev/feature/feat-001-x');
  writeFileSync(join(repo, 'feature.js'), 'export const feature = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'feature');
  git('checkout', '-q', 'main');
  const workspaceRoot = join(root, 'workspace');
  const runner = new GitFeatureChecks({
    workspaceRoot,
    installer: { provision: async () => ({ log: '' }) },
    environmentFor: () => null,
  });
  const input = { projectId, repositoryRoot: repo, targetBranch: 'main', branch: 'graphdev/feature/feat-001-x' };
  return { repo, git, runner, input, workspaceRoot };
}

describe('integration checks on the merged result (plan C6)', () => {
  it('runs the checks on main with the feature merged, moves no branch and leaves no worktree', async () => {
    const { git, runner, input, workspaceRoot } = repository();
    const before = [git('rev-parse', 'main'), git('rev-parse', 'graphdev/feature/feat-001-x')];
    const result = await runner.run({ ...input, commands: ['node check.js'] });
    expect(result).toMatchObject({ passed: true, detail: null, baseCommit: before[0], featureCommit: before[1] });
    expect(result.checks).toMatchObject([{ command: 'node check.js', passed: true }]);
    expect([git('rev-parse', 'main'), git('rev-parse', 'graphdev/feature/feat-001-x')]).toEqual(before);
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
    const checks = join(workspaceRoot, 'projects', projectId, 'checks');
    expect(existsSync(checks) ? readdirSync(checks) : []).toEqual([]);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('a failing check gives the end of its output', async () => {
    const { runner, input } = repository();
    const result = await runner.run({ ...input, commands: ['node -e process.exit(3)', 'node check.js'] });
    expect(result.passed).toBe(false);
    expect(result.checks.map(check => check.passed)).toEqual([false, true]);
  });

  it('a feature that collides with main is reported without running anything', async () => {
    const { repo, git, runner, input } = repository();
    writeFileSync(join(repo, 'feature.js'), 'export const other = 2;\n');
    git('add', '-A');
    git('commit', '-qm', 'main also writes feature.js');
    const result = await runner.run({ ...input, commands: ['node check.js'] });
    expect(result).toMatchObject({ passed: false, checks: [] });
    expect(result.detail).toContain('choca con main');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
  });
});
