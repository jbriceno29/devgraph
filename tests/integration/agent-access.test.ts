import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import { ExecutionValidator } from '../../src/modules/execution/infrastructure/execution-validator.js';
import { DEFAULT_DECISION_POLICY } from '../../src/modules/autopilot/domain/decision-policy.js';
import type { InceptionEnginePort } from '../../src/modules/inception/application/ports/inception-port.js';
import type { InceptionViewDto } from '../../src/shared/contracts/inception-view.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import type { ExecutionPolicyDto } from '../../src/shared/contracts/agent-view.js';
import type { AgentAccessProposalDto } from '../../src/shared/contracts/repository-scan.js';
import { proposal, usage } from './inception-fixtures.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A Next.js repository whose code lives outside src/ (app/, components/, lib/). */
function nextRepository(base: string): string {
  const root = join(base, 'tienda-next');
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'tienda-next',
      scripts: { dev: 'next dev', test: 'vitest run', lint: 'next lint', build: 'next build' },
    }),
    'next.config.mjs': 'export default {};\n',
    'tsconfig.json': '{}\n',
    'app/page.tsx': 'export default function Page() { return null; }\n',
    'components/Cart.tsx': 'export const Cart = () => null;\n',
    'lib/prices.ts': 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);\n',
    'docs/notes.md': '# Notas\n',
    '.github/workflows/ci.yml': 'name: ci\n',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Tests');
  git(root, 'config', 'user.email', 'tests@graphdev.local');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'tienda');
  return root;
}

const engine: InceptionEnginePort = {
  askGoals: async () => ({
    questions: [{ id: 'q1', text: '¿Qué sigue?', options: ['Carrito'], default: 'Carrito', why: 'Alcance.' }],
    assumptions: [],
    inferences: [],
    usage,
  }),
  propose: async input => ({
    draft: {
      title: 'Inicio: tienda existente',
      rationale: 'Parte del código que ya hay.',
      operations: proposal().map(op => {
        if (op.type === 'SET_PROJECT_PROFILE') {
          const { stackProfileId: _brownfieldKeepsItsStack, ...rest } = op;
          return rest;
        }
        return op.type === 'CREATE_RELATIONSHIP' && op.targetId === 'ROOT'
          ? { ...op, targetId: input.project.rootId }
          : op;
      }) as ChangeOperation[],
    },
    assumptions: [],
    usage,
  }),
  exploreUi: async () => ({ options: [], assumptions: [], usage }),
};

async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'graphdev2-access-'));
  roots.push(base);
  const core = createWorkspaceCore(join(base, 'workspace'), () => undefined, { inceptionEngine: engine });
  cores.push(core);
  const call = async <T>(channel: string, ...args: unknown[]) =>
    (await core.handle({ channel: channel as never, args })) as T;
  const projectId = (await call<{ id: string }>('project:create', { name: 'Tienda', slug: 'tienda' })).id;
  await call('project:open', projectId);
  const repo = nextRepository(base);
  await call('repository:configure', projectId, repo);
  const settled = async () => {
    await core.inceptionSettled(projectId);
    return call<InceptionViewDto>('inception:get', projectId);
  };
  return { base, repo, projectId, call, settled };
}

describe('acceso del agente derivado del repositorio (plan REP, R1)', () => {
  it('suggests the folders the repository has, lets the user edit them and saves them in the policy on approval', async () => {
    const { projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Añadir un carrito' });
    const asked = await settled();
    const access = asked.repository!.access!;
    expect(access.edited).toBe(false);
    expect(access.writable).toEqual(
      expect.arrayContaining([
        { pattern: 'app/**', reason: 'CODE' },
        { pattern: 'components/**', reason: 'CODE' },
        { pattern: 'lib/**', reason: 'CODE' },
        { pattern: 'next.config.mjs', reason: 'CONFIG' },
        { pattern: 'package.json', reason: 'CONFIG' },
        { pattern: 'node_modules/**', reason: 'GENERATED' },
      ]),
    );
    expect(access.writable.map(path => path.pattern)).not.toEqual(
      expect.arrayContaining(['docs/**', '.github/**', 'src/**']),
    );
    expect(access.verificationCommands).toEqual(['npm test', 'npm run lint', 'npm run build']);

    // An unsafe path is refused with the reason; nothing is sent to the engine.
    await expect(
      call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Carrito' }], undefined, {
        access: { writablePaths: ['../fuera/**'], verificationCommands: ['npm test'] },
      }),
    ).rejects.toThrow(/no puede salir del repositorio/);
    const edited = ['app/**', 'components/**', 'server/**', 'next.config.mjs', 'package.json'];
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Carrito' }], undefined, {
      access: { writablePaths: edited, verificationCommands: ['npm test'] },
    });
    const proposed = await settled();
    expect(proposed.repository!.access).toMatchObject({ edited: true, verificationCommands: ['npm test'] });
    expect(proposed.repository!.access!.writable).toContainEqual({ pattern: 'server/**', reason: 'USER' });

    await call('inception:approve', projectId);
    const policy = await call<ExecutionPolicyDto>('policy:get', projectId);
    expect(policy.writablePaths).toEqual(edited);
    expect(policy.allowedCommands).toEqual(['npm test']);
    expect(policy.deniedPaths).toEqual(expect.arrayContaining(['.env*', '.git/config']));
  });

  it('proposes the same from Ajustes for a project created before, without saving anything', async () => {
    const { projectId, call } = await setup();
    const before = await call<ExecutionPolicyDto>('policy:get', projectId);
    const proposed = await call<AgentAccessProposalDto>('policy:propose_from_repository', projectId);
    expect(proposed.writable.map(path => path.pattern)).toEqual(expect.arrayContaining(['app/**', 'lib/**']));
    expect(proposed.verificationCommands[0]).toBe('npm test');
    expect(await call<ExecutionPolicyDto>('policy:get', projectId)).toEqual(before);
  });

  it('a run that writes in app/ is not reverted with the derived paths (it was with the defaults)', async () => {
    const { base, repo, projectId, call } = await setup();
    const proposed = await call<AgentAccessProposalDto>('policy:propose_from_repository', projectId);
    const base_ = git(repo, 'rev-parse', 'HEAD');
    const policyFor = (writablePaths: string[]) => ({
      id: 'p',
      projectId,
      name: 'test',
      writablePaths,
      readonlyPaths: [],
      deniedPaths: ['.env*'],
      allowedCommands: [],
      autoApproveScopes: [],
      requireWorktreeIsolation: true,
      maxExecutionMinutes: 30,
      maxTurns: 0,
      decisionPolicy: DEFAULT_DECISION_POLICY,
    });
    const run = async (id: string, writablePaths: string[]) => {
      const worktree = join(base, 'wt', id);
      mkdirSync(dirname(worktree), { recursive: true });
      git(repo, 'worktree', 'add', '--detach', '--quiet', worktree, base_);
      writeFileSync(join(worktree, 'app', 'cart.tsx'), 'export const cart = [];\n');
      return new ExecutionValidator(join(base, 'workspace'), () => undefined).validate({
        projectId,
        executionId: id,
        workingDirectory: worktree,
        repositoryRoot: repo,
        repositoryId: 'repo',
        initialCommit: base_,
        policy: policyFor(writablePaths),
      });
    };
    expect(
      (
        await run(
          '44444444-4444-4444-8444-444444444441',
          proposed.writable.map(path => path.pattern),
        )
      ).passed,
    ).toBe(true);
    const defaults = await run('44444444-4444-4444-8444-444444444442', ['src/**', 'tests/**', 'docs/**']);
    expect(defaults.passed).toBe(false);
    expect(defaults.resultSummary).toContain('app/cart.tsx');
  });
});
