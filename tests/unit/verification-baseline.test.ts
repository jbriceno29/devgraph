import { describe, expect, it } from 'vitest';
import { AcceptKnownFailures } from '../../src/modules/environment/application/accept-known-failures.js';
import { BaselineRegistry } from '../../src/modules/environment/application/baseline-registry.js';
import { GetVerificationBaseline } from '../../src/modules/environment/application/get-verification-baseline.js';
import { RunVerificationBaseline } from '../../src/modules/environment/application/run-verification-baseline.js';
import {
  blockingFailures,
  checkLine,
  testCounts,
  type VerificationBaseline,
} from '../../src/modules/environment/domain/verification-baseline.js';
import { FIX_VERIFICATION_TITLE, withBaseline } from '../../src/modules/inception/application/baseline-plan.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import { autopilotHandlers } from '../../src/modules/autopilot/ipc.js';

describe('verification baseline (plan REP, R2)', () => {
  it('reads the test counts of Vitest, Jest, node:test and pytest', () => {
    expect(testCounts(' Test Files  1 failed | 4 passed (5)\n      Tests  3 failed | 48 passed (51)')).toEqual({
      passed: 48,
      failed: 3,
    });
    expect(testCounts('Tests:       2 failed, 10 passed, 12 total')).toEqual({ passed: 10, failed: 2 });
    expect(testCounts('ℹ tests 15\nℹ pass 14\nℹ fail 1\n')).toEqual({ passed: 14, failed: 1 });
    expect(testCounts('===== 1 failed, 9 passed in 0.52s =====')).toEqual({ passed: 9, failed: 1 });
    expect(testCounts('eslint found 3 problems')).toBeNull();
    expect(checkLine({ command: 'npm test', passed: false, counts: { passed: 48, failed: 3 } })).toBe(
      'npm test: pasan 48, fallan 3',
    );
    expect(checkLine({ command: 'npm run lint', passed: true, counts: null })).toBe('npm run lint: pasa');
    expect(checkLine({ command: 'npm test', passed: false, timedOut: true, counts: null })).toBe(
      'npm test: se cortó por tiempo',
    );
  });

  const failing: VerificationBaseline = {
    ranAt: 'now',
    ref: 'main',
    commit: 'c',
    checks: [
      { command: 'npm test', passed: false, tail: 'expected 2 to be 3', counts: { passed: 4, failed: 1 } },
      { command: 'npm run lint', passed: true, tail: '', counts: null },
    ],
    knownFailing: [],
  };

  it('starts «Fundación» with the fix task; accepted failures leave the checks and go to the rules', () => {
    const operations: ChangeOperation[] = [
      {
        type: 'SET_PROJECT_PROFILE',
        objectives: ['x'],
        outOfScope: [],
        techStack: { lenguaje: 'TS' },
        rules: ['Textos en español.'],
        verificationCommands: ['npm test', 'npm run lint'],
      },
      { type: 'CREATE_MODULE', tempId: '$m', parentId: 'root', title: 'Base', summary: '', purpose: '' },
      {
        type: 'CREATE_FEATURE',
        tempId: '$f',
        moduleId: '$m',
        title: 'Fundación',
        summary: '',
        scope: '',
        priority: 'HIGH',
      },
      {
        type: 'CREATE_WORK_ITEM',
        tempId: '$t',
        parentId: '$f',
        workType: 'TASK',
        title: 'README',
        summary: '',
        acceptanceCriteria: [],
      },
    ];
    const planned = withBaseline(operations, failing);
    expect(planned.map(op => ('title' in op ? op.title : op.type))).toEqual([
      'SET_PROJECT_PROFILE',
      'Base',
      'Fundación',
      FIX_VERIFICATION_TITLE,
      'README',
    ]);
    const task = planned[3] as Extract<ChangeOperation, { type: 'CREATE_WORK_ITEM' }>;
    expect(task).toMatchObject({
      parentId: '$f',
      priority: 'CRITICAL',
      acceptanceCriteria: ['«npm test» pasa en la rama de la feature.'],
    });
    expect(task.summary).toContain('expected 2 to be 3');
    expect((planned[0] as { verificationCommands: string[] }).verificationCommands).toEqual([
      'npm test',
      'npm run lint',
    ]);
    const known = withBaseline(operations, { ...failing, knownFailing: ['npm test'] });
    expect((known[0] as { verificationCommands: string[] }).verificationCommands).toEqual(['npm run lint']);
    expect((known[0] as { rules: string[] }).rules.at(-1)).toContain('Fallos conocidos al empezar: npm test');
    expect(withBaseline(operations, { ...failing, checks: [failing.checks[1]!] })).toBe(operations);
  });

  const setup = (stored: VerificationBaseline | null) => {
    let baseline = stored;
    const store = { get: () => baseline, save: (_: string, next: VerificationBaseline) => void (baseline = next) };
    const registry = new BaselineRegistry();
    let finish: (value: never) => void = () => undefined;
    const runner = { run: () => new Promise<never>(resolve => (finish = resolve as never)) };
    const commands = {
      defaults: () => ['npm test'],
      issues: (list: string[]) => (list.some(c => c.includes('|')) ? ['no'] : []),
    };
    const policy = { excluded: [] as string[][], restored: [] as string[][] };
    const policyPort = {
      exclude: (_: string, list: string[]) => void policy.excluded.push(list),
      restore: (_: string, list: string[]) => void policy.restored.push(list),
    };
    const status = new GetVerificationBaseline(store, registry, commands);
    return {
      policy,
      status,
      run: new RunVerificationBaseline(store, registry, runner, commands, status, policyPort),
      accept: new AcceptKnownFailures(store, status, policyPort),
      finish: (value: unknown) => finish(value as never),
      stored: () => baseline,
    };
  };

  it('runs in the background, keeps known failures only while they still fail, and refuses odd commands', async () => {
    const s = setup({ ...failing, knownFailing: ['npm test'] });
    expect(() => s.run.execute('p', ['npm test | tee x'])).toThrow('no');
    expect(s.run.execute('p').status).toBe('RUNNING');
    s.finish({
      ref: 'main',
      commit: 'c2',
      results: [{ command: 'npm test', exitCode: 1, output: 'ℹ pass 4\nℹ fail 1' }],
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.status.execute('p')).toMatchObject({
      status: 'DONE',
      knownFailing: ['npm test'],
      blocking: [],
      checks: [{ summary: 'npm test: pasan 4, fallan 1' }],
    });
    s.run.execute('p');
    s.finish({
      ref: 'main',
      commit: 'c3',
      results: [{ command: 'npm test', exitCode: 0, output: 'ℹ pass 5\nℹ fail 0' }],
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.stored()!.knownFailing).toEqual([]);
    // It passes now: the command goes back to the verification.
    expect(s.policy.restored.at(-1)).toEqual(['npm test']);
  });

  it('accepts only failing commands as known; then the pilot may start', () => {
    const s = setup(failing);
    expect(blockingFailures(s.stored())).toEqual(['npm test']);
    expect(() => s.accept.execute('p', ['npm run lint'])).toThrow('no fallan en la línea base: npm run lint');
    expect(s.accept.execute('p', ['npm test']).blocking).toEqual([]);
    expect(s.policy.excluded.at(-1)).toEqual(['npm test']);
    s.accept.execute('p', []);
    expect(s.policy.restored.at(-1)).toEqual(['npm test']);
  });

  it('pilot:start is refused while the baseline fails', async () => {
    const handlers = autopilotHandlers({
      workspaceRoot: '/tmp',
      pilot: () => ({ start: async () => ({ ok: true }) }) as never,
      featureReport: () => ({ report: null, markdown: '' }),
      baseline: { pilotBlocker: () => 'La verificación de la rama base falla (npm test).' },
    });
    await expect(
      Promise.resolve().then(() => handlers['pilot:start']!(['p', 'f', { acknowledgeCost: true }])),
    ).rejects.toThrow('La verificación de la rama base falla (npm test).');
  });
});
