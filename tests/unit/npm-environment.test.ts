import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NpmEnvironment, npmName } from '../../src/modules/environment/infrastructure/npm-environment.js';
import { environmentFor } from '../../src/modules/projects/domain/stack-catalog.js';

/** npm is never reached in these cases except where noted: a missing binary would make the test fail loudly. */
const environment = environmentFor('web-spa-react', ['left-pad'])!;
const manifest = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) =>
  JSON.stringify({ name: 'x', dependencies, devDependencies });
function worktree(content: string) {
  const directory = mkdtempSync(join(tmpdir(), 'graphdev2-npm-'));
  writeFileSync(join(directory, 'package.json'), content);
  return directory;
}

describe('npm environment (plan S2)', () => {
  const npm = new NpmEnvironment({ npm: '/nonexistent/npm' });
  it('does nothing when the agent left the dependencies alone', async () => {
    const base = manifest({ react: '^19.0.0' });
    expect(
      await npm.reconcile({
        workingDirectory: worktree(JSON.stringify({ ...JSON.parse(base), scripts: { test: 'vitest' } })),
        baseManifest: base,
        environment,
      }),
    ).toEqual({ ok: true, log: '' });
  });
  it('refuses packages outside the profile and the approvals, also when only their version or section changed', async () => {
    const base = manifest({ react: '^19.0.0', lodash: '^4.0.0' });
    const result = await npm.reconcile({
      workingDirectory: worktree(manifest({ react: '^19.0.0', lodash: '^4.1.0', zod: '^4.0.0' })),
      baseManifest: base,
      environment,
    });
    expect(result).toMatchObject({ ok: false, reason: 'DEPENDENCY_APPROVAL', unapproved: ['lodash', 'zod'] });
    const moved = await npm.reconcile({
      workingDirectory: worktree(manifest({}, { lodash: '^4.0.0', react: '^19.0.0' })),
      baseManifest: base,
      environment,
    });
    expect(moved).toMatchObject({ ok: false, unapproved: ['lodash'] });
  });
  it('reinstalls when only allowed packages changed (here npm is missing, so it reports the environment)', async () => {
    const result = await npm.reconcile({
      workingDirectory: worktree(manifest({ react: '^19.0.0', 'left-pad': '^1.3.0' })),
      baseManifest: manifest({ react: '^19.0.0' }),
      environment,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'ENVIRONMENT',
      log: expect.stringContaining('No se encontró npm'),
    });
  });
  it('reports a manifest the agent broke', async () => {
    expect(
      await npm.reconcile({ workingDirectory: worktree('{ not json'), baseManifest: manifest({}), environment }),
    ).toMatchObject({ ok: false, reason: 'ENVIRONMENT' });
  });
  it('builds a valid npm name and has no environment for profiles without packages', () => {
    expect(npmName('Gestión de Notas!')).toBe('gestion-de-notas');
    expect(npmName('???')).toBe('proyecto');
    expect(environmentFor('minimo-node')).toBeNull();
    expect(environmentFor('desconocido')).toMatchObject({
      stackProfileId: null,
      packageManager: 'detect',
      dependencies: [],
    });
    expect(environmentFor(null, ['zod', 'Mal'])).toMatchObject({ allowedPackages: ['zod'] });
    expect(environmentFor('web-spa-react', ['Mal Nombre', 'zod'])!.allowedPackages).toContain('zod');
    expect(environmentFor('web-spa-react', ['Mal Nombre'])!.allowedPackages).not.toContain('Mal Nombre');
  });
});

describe('an existing repository whose root declares no dependencies (a pnpm monorepo, seen with a real project)', () => {
  const detect = environmentFor(null)!;
  /** A fake pnpm that records its arguments, so the test checks what would be installed without a network. */
  function fakePnpm() {
    const directory = mkdtempSync(join(tmpdir(), 'graphdev2-npm-'));
    const executable = join(directory, 'pnpm');
    writeFileSync(executable, `#!/bin/sh\necho "$@" >> "${join(directory, 'calls')}"\n`);
    chmodSync(executable, 0o755);
    return {
      executable,
      calls: () => (existsSync(join(directory, 'calls')) ? readFileSync(join(directory, 'calls'), 'utf8') : ''),
    };
  }
  it('installs from the root with the lockfile when it is a workspace', async () => {
    const pnpm = fakePnpm();
    const root = worktree(JSON.stringify({ name: 'monorepo', private: true, scripts: { test: 'pnpm -r test' } }));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const result = await new NpmEnvironment({ pnpm: pnpm.executable }).provision({
      workingDirectory: root,
      projectName: 'm',
      environment: detect,
    });
    expect(result).toMatchObject({ installed: true, manager: 'pnpm', commit: null });
    expect(pnpm.calls()).toContain('install --frozen-lockfile --ignore-scripts');
  });
  it('still installs nothing for a root with no dependencies, lockfile or workspace', async () => {
    const pnpm = fakePnpm();
    const result = await new NpmEnvironment({ pnpm: pnpm.executable, npm: pnpm.executable }).provision({
      workingDirectory: worktree(JSON.stringify({ name: 'solo', scripts: { test: 'node --test' } })),
      projectName: 's',
      environment: detect,
    });
    expect(result).toMatchObject({ installed: false });
    expect(pnpm.calls()).toBe('');
  });
});
