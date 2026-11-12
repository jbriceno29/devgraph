import { DEFAULT_DECISION_POLICY } from '../../src/domain/autonomy/decision-policy.js';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ExecutionValidator, glob } from '../../src/infrastructure/execution/execution-validator.js';
import type { AutonomyPolicy } from '../../src/domain/governance/models.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const policy: AutonomyPolicy = {
  id: 'policy',
  projectId: '11111111-1111-4111-8111-111111111111',
  name: 'test',
  writablePaths: ['src/**'],
  readonlyPaths: ['docs/adr/**'],
  deniedPaths: ['.env*'],
  allowedCommands: [],
  autoApproveScopes: [],
  requireWorktreeIsolation: true,
  maxExecutionMinutes: 30,
  maxTurns: 0,
  decisionPolicy: DEFAULT_DECISION_POLICY,
};

describe('ExecutionValidator', () => {
  it('fails and reverts denied paths while preserving an audit patch and log', async () => {
    const root = repository(),
      workspace = join(root, 'workspace'),
      id = '22222222-2222-4222-8222-222222222222',
      projectId = policy.projectId;
    writeFileSync(join(root, 'repo', '.gitignore'), '.env.local\n');
    execFileSync('git', ['add', '.'], { cwd: join(root, 'repo') });
    execFileSync('git', ['commit', '--quiet', '-m', 'add protected file'], { cwd: join(root, 'repo') });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, 'repo'), encoding: 'utf8' }).trim();
    const worktree = join(workspace, 'projects', projectId, 'worktrees', id);
    mkdirSync(dirname(worktree), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, base], { cwd: join(root, 'repo') });
    writeFileSync(join(worktree, '.env.local'), 'secret=changed\n');
    writeFileSync(join(worktree, 'config.secret'), 'no\n');
    writeFileSync(join(worktree, 'src', 'allowed.ts'), 'export const ok = true;\n');
    const recorded: Array<{ filePath: string }> = [];
    const validator = new ExecutionValidator(workspace, (_executionId, _repositoryId, diffs) =>
      recorded.push(...diffs),
    );
    const result = await validator.validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    expect(result.passed).toBe(false);
    expect(result.testSummary).toMatchObject({ reason: 'SANDBOX_POLICY_VIOLATION' });
    expect((result.testSummary as { violations: string[] }).violations).toEqual(
      expect.arrayContaining(['.env.local', 'config.secret']),
    );
    expect(existsSync(join(worktree, '.env.local'))).toBe(false);
    expect(existsSync(join(worktree, 'config.secret'))).toBe(false);
    expect(existsSync(join(worktree, 'src', 'allowed.ts'))).toBe(true);
    expect(recorded.map(item => item.filePath)).toEqual(
      expect.arrayContaining(['.env.local', 'config.secret', 'src/allowed.ts']),
    );
    expect(
      readFileSync(join(workspace, 'projects', projectId, 'executions', id, 'changes.patch'), 'utf8'),
    ).not.toContain('secret=changed');
    expect(readFileSync(join(workspace, 'projects', projectId, 'executions', id, 'test-output.log'), 'utf8')).toContain(
      'El agente tocó rutas que no tiene permitidas',
    );
  });

  it('accepts allowed paths and records the final commit plus the patch', async () => {
    const root = repository(),
      workspace = join(root, 'workspace'),
      id = '33333333-3333-4333-8333-333333333333',
      projectId = policy.projectId;
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, 'repo'), encoding: 'utf8' }).trim();
    const worktree = join(workspace, 'projects', projectId, 'worktrees', id);
    mkdirSync(dirname(worktree), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, base], { cwd: join(root, 'repo') });
    writeFileSync(join(worktree, 'src', 'feature.ts'), 'export const feature = true;\n');
    const validator = new ExecutionValidator(workspace, () => undefined);
    const result = await validator.validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    expect(result).toMatchObject({
      passed: true,
      finalCommit: base,
      resultSummary: 'Los cambios solo tocan rutas permitidas. No hay comandos de verificación configurados.',
    });
    expect(readFileSync(join(workspace, 'projects', projectId, 'executions', id, 'changes.patch'), 'utf8')).toContain(
      'feature.ts',
    );
    expect(existsSync(join(workspace, 'projects', projectId, 'executions', id, 'test-output.log'))).toBe(true);
  });

  it('ignores a crafted .git pointer: never runs its fsmonitor command and restores the real pointer', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('55555555-5555-4555-8555-555555555555');
    const marker = join(root, 'PWNED'),
      crafted = join(worktree, 'src', 'crafted-git'),
      original = readFileSync(join(worktree, '.git'), 'utf8');
    execFileSync('git', ['clone', '--quiet', '--bare', join(root, 'repo'), crafted]);
    writeFileSync(
      join(crafted, 'config'),
      `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = touch ${marker}; false\n`,
    );
    writeFileSync(join(worktree, '.git'), `gitdir: ${crafted}\n`);
    const result = await new ExecutionValidator(workspace, () => undefined).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    expect(existsSync(marker)).toBe(false);
    expect(result.passed).toBe(false);
    expect((result.testSummary as { violations: string[] }).violations).toContain('.git');
    expect(readFileSync(join(worktree, '.git'), 'utf8')).toBe(original);
  });

  it('rejects changed symlinks that escape the worktree or reach denied paths', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('66666666-6666-4666-8666-666666666666');
    writeFileSync(join(root, 'outside.txt'), 'outside\n');
    symlinkSync(join(root, 'outside.txt'), join(worktree, 'src', 'outside-link'));
    symlinkSync('/', join(worktree, 'src', 'root-link'));
    symlinkSync('../.env', join(worktree, 'src', 'env-link'));
    symlinkSync('base.ts', join(worktree, 'src', 'inside-link'));
    const result = await new ExecutionValidator(workspace, () => undefined).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    const violations = (result.testSummary as { violations: string[] }).violations;
    expect(result.passed).toBe(false);
    expect(violations).toEqual(expect.arrayContaining(['src/outside-link', 'src/root-link', 'src/env-link']));
    expect(violations).not.toContain('src/inside-link');
    expect(existsSync(join(worktree, 'src', 'outside-link'))).toBe(false);
    expect(existsSync(join(root, 'outside.txt'))).toBe(true);
  });

  it('never copies the content of untracked denied files into the patch or diff rows', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('77777777-7777-4777-8777-777777777777');
    writeFileSync(join(worktree, '.env'), 'TOKEN=super-secret\n');
    writeFileSync(join(worktree, 'src', 'ok.ts'), 'export const ok = 1;\n');
    const recorded: Array<{ filePath: string; diffPatch: string | null }> = [];
    const result = await new ExecutionValidator(workspace, (_e, _r, diffs) => recorded.push(...diffs)).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    expect(result.passed).toBe(false);
    const patch = readFileSync(join(workspace, 'projects', projectId, 'executions', id, 'changes.patch'), 'utf8');
    expect(patch).not.toContain('super-secret');
    expect(patch).toContain('ok.ts');
    expect(recorded.find(row => row.filePath === '.env')).toMatchObject({ diffPatch: null, changeType: 'ADDED' });
    expect(JSON.stringify(recorded)).not.toContain('super-secret');
    expect(existsSync(join(worktree, '.env'))).toBe(false);
  });

  it('accepts ignored build directories covered by dir/** without deleting them (D2)', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('88888888-8888-4888-8888-888888888888');
    const gitDir = resolve(
      worktree,
      execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: worktree, encoding: 'utf8' }).trim(),
    );
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(join(gitDir, 'info', 'exclude'), 'node_modules/\ndist/\n');
    mkdirSync(join(worktree, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(worktree, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
    mkdirSync(join(worktree, 'dist'));
    writeFileSync(join(worktree, 'dist', 'out.js'), 'built\n');
    writeFileSync(join(worktree, 'src', 'feature.ts'), 'export const f = 1;\n');
    const result = await new ExecutionValidator(workspace, () => undefined).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy: { ...policy, writablePaths: ['src/**', 'node_modules/**', 'dist/**'] },
    });
    expect(result).toMatchObject({ passed: true });
    expect(existsSync(join(worktree, 'node_modules', 'left-pad', 'index.js'))).toBe(true);
    expect(existsSync(join(worktree, 'dist', 'out.js'))).toBe(true);
  });

  it('still rejects ignored directories that the policy does not make writable (D2)', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('99999999-9999-4999-8999-999999999999');
    const gitDir = resolve(
      worktree,
      execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: worktree, encoding: 'utf8' }).trim(),
    );
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(join(gitDir, 'info', 'exclude'), 'build/\n');
    mkdirSync(join(worktree, 'build'));
    writeFileSync(join(worktree, 'build', 'out.bin'), 'x');
    const result = await new ExecutionValidator(workspace, () => undefined).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    expect(result.passed).toBe(false);
    expect((result.testSummary as { violations: string[] }).violations).toEqual(['build']);
    expect(existsSync(join(worktree, 'build'))).toBe(false);
  });

  it('denies name-only patterns at any depth, case-insensitively (D3)', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    mkdirSync(join(worktree, 'src', 'sub'));
    writeFileSync(join(worktree, 'src', '.env'), 'A=1\n');
    writeFileSync(join(worktree, 'src', 'sub', '.env.prod'), 'B=2\n');
    writeFileSync(join(worktree, 'src', 'sub', '.ENV.local'), 'C=3\n');
    writeFileSync(join(worktree, 'src', 'environment.ts'), 'export {};\n');
    const result = await new ExecutionValidator(workspace, () => undefined).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy,
    });
    const violations = (result.testSummary as { violations: string[] }).violations;
    expect(result.passed).toBe(false);
    expect(violations.sort()).toEqual(['src/.env', 'src/sub/.ENV.local', 'src/sub/.env.prod']);
    expect(existsSync(join(worktree, 'src', 'environment.ts'))).toBe(true);
  });

  it('commits accepted work on the execution branch, with a neutral identity when none is configured (Stage 1)', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    execFileSync('git', ['config', '--unset', 'user.email'], { cwd: join(root, 'repo') });
    execFileSync('git', ['config', '--unset', 'user.name'], { cwd: join(root, 'repo') });
    const emptyGlobal = join(root, 'empty.gitconfig');
    writeFileSync(emptyGlobal, '');
    const saved = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    };
    Object.assign(process.env, { GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1' });
    try {
      writeFileSync(join(worktree, 'src', 'feature.ts'), 'export const feature = 1;\n');
      const result = await new ExecutionValidator(workspace, () => undefined).validate({
        projectId,
        executionId: id,
        workingDirectory: worktree,
        repositoryRoot: join(root, 'repo'),
        repositoryId: 'repo-id',
        initialCommit: base,
        policy,
        commitMessage: 'TASK-001: Add feature\n\nGraph Workspace execution x',
      });
      expect(result.passed).toBe(true);
      expect(result.finalCommit).not.toBe(base);
      const log = execFileSync('git', ['log', '-1', '--format=%s|%an|%ae'], { cwd: worktree, encoding: 'utf8' }).trim();
      expect(log).toBe('TASK-001: Add feature|Graph Workspace|graph-workspace@localhost');
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' })).toBe('');
      expect(
        execFileSync('git', ['show', '--name-only', '--format=', result.finalCommit!], {
          cwd: worktree,
          encoding: 'utf8',
        }).trim(),
      ).toBe('src/feature.ts');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('does not commit when a verification command fails', async () => {
    const { root, workspace, worktree, base, id, projectId } = isolated('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    writeFileSync(join(worktree, 'src', 'broken.ts'), 'export const broken = 1;\n');
    const result = await new ExecutionValidator(workspace, () => undefined).validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy: { ...policy, allowedCommands: ['node -e process.exit(1)'] },
      commitMessage: 'TASK-002: Broken',
    });
    expect(result.passed).toBe(false);
    expect(result.finalCommit).toBe(base);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' })).toContain(
      'src/broken.ts',
    );
  });

  it('runs only commands listed in the autonomy policy and writes their output', async () => {
    const root = repository(),
      workspace = join(root, 'workspace'),
      id = '44444444-4444-4444-8444-444444444444',
      projectId = policy.projectId;
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, 'repo'), encoding: 'utf8' }).trim();
    const worktree = join(workspace, 'projects', projectId, 'worktrees', id);
    mkdirSync(dirname(worktree), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, base], { cwd: join(root, 'repo') });
    const validator = new ExecutionValidator(workspace, () => undefined);
    const result = await validator.validate({
      projectId,
      executionId: id,
      workingDirectory: worktree,
      repositoryRoot: join(root, 'repo'),
      repositoryId: 'repo-id',
      initialCommit: base,
      policy: { ...policy, allowedCommands: ['node --version'] },
    });
    expect(result.passed).toBe(true);
    expect(result.testSummary).toMatchObject({
      skipped: false,
      commands: [{ command: 'node --version', exitCode: 0 }],
    });
    expect(readFileSync(join(workspace, 'projects', projectId, 'executions', id, 'test-output.log'), 'utf8')).toContain(
      process.versions.node,
    );
    await expect(
      validator.validate({
        projectId,
        executionId: id,
        workingDirectory: worktree,
        repositoryRoot: join(root, 'repo'),
        repositoryId: 'repo-id',
        initialCommit: base,
        policy: { ...policy, allowedCommands: ['node --version; touch /tmp/should-not-run'] },
      }),
    ).rejects.toThrow('Shell operators are not allowed');
  });
});

describe('policy glob', () => {
  it.each([
    ['.env*', '.env', true],
    ['.env*', 'src/sub/.env.prod', true],
    ['.env*', 'src/environment.ts', false],
    ['.env*', '.envrc/config', true],
    ['node_modules/**', 'node_modules', true],
    ['node_modules/**', 'node_modules/a/b.js', true],
    ['node_modules/**', 'src/node_modules', false],
    ['src/**', 'src/a.ts', true],
    ['src/**', 'tests/src/a.ts', false],
    ['/README.md', 'README.md', true],
    ['/README.md', 'docs/README.md', false],
    ['docs/architecture/ADR/**', 'docs/architecture/ADR', true],
    ['**/secrets', 'secrets', true],
    ['**/secrets', 'a/b/secrets', true],
    ['*.md', 'docs/a.md', true],
    ['src/*.ts', 'src/a/b.ts', false],
  ])('%s matches %s → %s', (pattern, path, expected) => {
    expect(glob(pattern).test(path)).toBe(expected);
  });
});

function isolated(id: string) {
  const root = repository(),
    workspace = join(root, 'workspace'),
    projectId = policy.projectId;
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, 'repo'), encoding: 'utf8' }).trim();
  const worktree = join(workspace, 'projects', projectId, 'worktrees', id);
  mkdirSync(dirname(worktree), { recursive: true });
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, base], { cwd: join(root, 'repo') });
  return { root, workspace, worktree, base, id, projectId };
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-validation-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '--quiet', repo]);
  execFileSync('git', ['config', 'user.name', 'Graphdev Tests'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'tests@graphdev.local'], { cwd: repo });
  writeFileSync(join(repo, 'src', 'base.ts'), 'export const base = true;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: repo });
  return root;
}
