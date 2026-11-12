import { describe, expect, it } from 'vitest';
import { checksOf } from '../../src/modules/execution/domain/check-summary.js';
import {
  DEFAULT_CHECK_TIMEOUT_MS,
  LONG_CHECK_TIMEOUT_MS,
  checkTimeoutMs,
} from '../../src/modules/execution/domain/check-timeouts.js';
import { FeatureCheckRegistry } from '../../src/modules/execution/application/feature-check-registry.js';
import { GetFeatureChecks } from '../../src/modules/execution/application/get-feature-checks.js';
import { IntegrateFeature, checksBlocker } from '../../src/modules/execution/application/integrate-feature.js';
import { RunFeatureChecks } from '../../src/modules/execution/application/run-feature-checks.js';
import type { FeatureCheckRun } from '../../src/modules/execution/application/ports/feature-check-port.js';
import { runChecks } from '../../src/modules/execution/infrastructure/run-checks.js';
import { integrationChecks } from '../../src/modules/projects/domain/agent-access.js';
import { findStackProfile } from '../../src/modules/projects/domain/stack-catalog.js';
import { checkDuration } from '../../src/desktop/presentation/agents/execution-checks.logic.js';

describe('per-check time limits (plan C6)', () => {
  it('gives builds and end-to-end tests minutes and everything else two', () => {
    for (const command of ['node_modules/.bin/next build', 'npm run build', 'pnpm run test:e2e', 'npx playwright test'])
      expect(checkTimeoutMs(command), command).toBe(LONG_CHECK_TIMEOUT_MS);
    for (const command of ['node_modules/.bin/tsc --noEmit', 'npm test', 'npm run lint', 'node --test'])
      expect(checkTimeoutMs(command), command).toBe(DEFAULT_CHECK_TIMEOUT_MS);
  });

  it('a check that runs out of time is reported as such, not as a plain failure', async () => {
    const report = await runChecks(
      process.cwd(),
      ['node -e setInterval(Object,1000)', 'node -e process.exit(0)'],
      undefined,
      () => 400,
    );
    expect(report.results[0]).toMatchObject({ exitCode: 1, timedOut: true });
    expect(report.results[0]!.output).toContain('se cortó a los 0 s sin terminar');
    expect(report.results[1]).toMatchObject({ exitCode: 0 });
    expect(checksOf({ commands: report.results }).map(check => [check.passed, check.timedOut ?? false])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('formats durations for Revisión', () => {
    expect(checkDuration(820)).toBe('0,8 s');
    expect(checkDuration(42_000)).toBe('42 s');
    expect(checkDuration(185_000)).toBe('3 min 5 s');
    expect(checkDuration(120_000)).toBe('2 min');
  });
});

describe('integration checks (plan C6)', () => {
  it('come from the catalog profile, or from the build script of a repository without one', () => {
    expect(
      integrationChecks({
        profileCommands: findStackProfile('web-nextjs')!.integrationCommands,
        packageJson: null,
        pnpm: false,
        verificationCommands: [],
      }),
    ).toEqual(['node_modules/.bin/next build']);
    const manifest = JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build' } });
    const base = { profileCommands: null, packageJson: manifest, pnpm: false, verificationCommands: ['npm test'] };
    expect(integrationChecks(base)).toEqual(['npm run build']);
    expect(integrationChecks({ ...base, pnpm: true })).toEqual(['pnpm run build']);
    expect(integrationChecks({ ...base, verificationCommands: ['npm run build'] })).toEqual([]);
    expect(integrationChecks({ ...base, packageJson: '{"scripts":{"test":"x"}}' })).toEqual([]);
  });

  const run = (passed: boolean, base = 'b1', feature = 'f1'): FeatureCheckRun => ({
    passed,
    checks: [{ command: 'next build', passed }],
    detail: passed ? null : 'Type error',
    baseCommit: base,
    featureCommit: feature,
  });
  const setup = (heads = { base: 'b1', feature: 'f1' }) => {
    const registry = new FeatureCheckRegistry();
    let finish: (value: FeatureCheckRun) => void = () => undefined;
    const runner = {
      heads: async () => heads,
      run: () => new Promise<FeatureCheckRun>(resolve => (finish = resolve)),
    };
    const catalog = {
      repositoryRoot: () => '/repo',
      features: () => [{ id: 'f', displayKey: 'FEAT-001', title: 'Base' }],
      integration: () => ({
        branchName: 'graphdev/feature/feat-001',
        targetBranch: 'main',
        integratedAt: null,
        taskCount: 1,
        openTaskCount: 0,
      }),
    };
    const commands = { commands: async () => ['next build'] };
    const status = new GetFeatureChecks(registry, catalog, runner, commands);
    return {
      registry,
      status,
      start: new RunFeatureChecks(registry, catalog, runner, commands, status),
      finish: (r: FeatureCheckRun) => finish(r),
      heads,
      catalog,
    };
  };

  it('go NOT_RUN → RUNNING → PASSED, and STALE once a branch moves', async () => {
    const s = setup();
    expect((await s.status.execute('p', 'f')).status).toBe('NOT_RUN');
    expect((await s.start.execute('p', 'f')).status).toBe('RUNNING');
    s.finish(run(true));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await s.status.execute('p', 'f')).toMatchObject({ status: 'PASSED', commands: ['next build'] });
    s.heads.feature = 'f2';
    expect((await s.status.execute('p', 'f')).status).toBe('STALE');
  });

  it('«Integrar» waits for checks that passed on the current branches', async () => {
    const s = setup();
    let integrated = 0;
    const git = {
      conflicts: async () => [],
      filesWithMarkers: async () => [],
      mergeWithConflicts: async () => ({ commit: '', conflicts: [] }),
    };
    const integrate = new IntegrateFeature(
      async () => {
        integrated++;
        return {
          featureId: 'f',
          branchName: 'b',
          targetBranch: 'main',
          merged: true,
          alreadyIntegrated: false,
          commit: 'c',
        };
      },
      git as never,
      s.catalog,
      (projectId, featureId) => s.status.execute(projectId, featureId),
    );
    await expect(integrate.execute('p', 'f')).rejects.toThrow('Pulsa «Comprobar antes de integrar»');
    await s.start.execute('p', 'f');
    s.finish(run(false));
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(integrate.execute('p', 'f')).rejects.toThrow(
      'no pasó las comprobaciones de integración (next build) y main no se tocó',
    );
    s.registry.set('p', 'f', { state: 'DONE', commands: ['next build'], run: run(true), checkedAt: 'now' });
    await integrate.execute('p', 'f');
    expect(integrated).toBe(1);
    expect(
      checksBlocker('FEAT-001', 'main', {
        featureId: 'f',
        status: 'NONE',
        commands: [],
        checks: [],
        detail: null,
        checkedAt: null,
      }),
    ).toBeNull();
  });
});
