import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type {
  InceptionEnginePort,
  InceptionProjectInput,
  RepositorySurveyorPort,
} from '../../src/modules/inception/application/ports/inception-port.js';
import { buildProposalPrompt } from '../../src/modules/inception/infrastructure/inception-contract.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import type { InceptionViewDto } from '../../src/shared/contracts/inception-view.js';
import type { GraphEdgeView, GraphNodeView } from '../../src/shared/contracts/graph-view.js';

type GraphViewDto = { nodes: GraphNodeView[]; edges: GraphEdgeView[] };
import { proposal, usage } from './inception-fixtures.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });

/** A small shop that already has a catalogue and a half-done export, with its tests. */
function shop(base: string): string {
  const root = join(base, 'tienda');
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'tienda', scripts: { test: 'node --test' } }),
    'README.md': '# Tienda\n\nnpm test\n',
    'src/catalog/catalog.js': 'export const list = () => [];\n',
    'src/catalog/search.js': 'export const search = () => [];\n',
    'src/export/csv.js': '// TODO: escapar comas\nexport const csv = () => "";\n',
    'tests/catalog.test.js': "import test from 'node:test';\ntest('ok', () => {});\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'tienda');
  return root;
}

/** What a real survey answers, with a made-up path and a capability without evidence (both must be dropped). */
const inventory = {
  modules: [
    {
      name: 'Catálogo',
      summary: 'Lista y búsqueda de productos.',
      paths: ['src/catalog/', 'src/no-existe/'],
      capabilities: [
        {
          title: 'Listar productos',
          summary: 'Devuelve el catálogo.',
          status: 'COMPLETE',
          missing: '',
          evidence: ['./src/catalog/catalog.js', 'tests/catalog.test.js'],
        },
        {
          title: 'Exportar a CSV',
          summary: 'Exporta.',
          status: 'PARTIAL',
          missing: 'Escapar comas.',
          evidence: ['src/export/csv.js'],
        },
        { title: 'Pagos', summary: 'Inventado.', status: 'COMPLETE', missing: '', evidence: ['src/pagos.js'] },
      ],
    },
    { name: 'Fantasma', summary: 'Nada.', paths: ['lib/'], capabilities: [] },
  ],
  entryPoints: [{ description: 'Módulo del catálogo', evidence: ['src/catalog/catalog.js'] }],
  tests: { description: 'node --test en tests/', evidence: ['tests'] },
  pending: [{ description: 'Escapar comas en el CSV', evidence: ['src/export/csv.js'] }],
};

/** A surveyor the test releases by hand, so it can check that the proposal waits for it. */
class FakeSurveyor implements RepositorySurveyorPort {
  calls = 0;
  signals: AbortSignal[] = [];
  release!: () => void;
  fail: string | null = null;
  constructor(private readonly repo: () => string) {}
  survey(input: Parameters<RepositorySurveyorPort['survey']>[0]) {
    this.calls += 1;
    this.signals.push(input.signal!);
    return new Promise<Awaited<ReturnType<RepositorySurveyorPort['survey']>>>((resolve, reject) => {
      this.release = () => {
        if (this.fail) return reject(new Error(this.fail));
        const tracked = git(this.repo(), 'ls-files').trim().split('\n');
        resolve({ raw: inventory, tracked, ref: 'main', commit: git(this.repo(), 'rev-parse', 'HEAD').trim(), usage });
      };
      input.signal?.addEventListener('abort', () => reject(new Error('cancelada')));
    });
  }
}

/** Proposes only new work hung on the map: a feature on the map's module and a task that completes the partial capability. */
class MappedEngine implements InceptionEnginePort {
  proposed: InceptionProjectInput[] = [];
  async askGoals() {
    return {
      questions: [
        {
          id: 'q1',
          text: '¿Qué quieres lograr ahora?',
          options: ['Una feature'],
          default: 'Una feature',
          why: 'Hito.',
        },
      ],
      assumptions: [],
      inferences: [],
      usage,
    };
  }
  async propose(input: Parameters<InceptionEnginePort['propose']>[0]) {
    this.proposed.push(input.project);
    const base = proposal().filter(op =>
      ['SET_PROJECT_PROFILE', 'CREATE_DECISION_RECORD', 'UPSERT_ARTIFACT'].includes(op.type),
    );
    const operations: ChangeOperation[] = [
      // Seen in the real run: the vision under the root AND an explicit DOCUMENTED_BY to it (the same edge twice).
      ...base.map(op => (op.type === 'UPSERT_ARTIFACT' ? { ...op, parentId: input.project.rootId } : op)),
      { type: 'CREATE_RELATIONSHIP', sourceId: input.project.rootId, targetId: '$vision', edgeType: 'DOCUMENTED_BY' },
      { type: 'CREATE_RELATIONSHIP', sourceId: '$adr', targetId: input.project.rootId, edgeType: 'AFFECTS' },
      {
        type: 'CREATE_FEATURE',
        tempId: '$fav',
        moduleId: '$map_mod_1',
        title: 'Favoritos',
        summary: 'Marcar productos.',
        scope: 'Catálogo',
        priority: 'HIGH',
      },
      {
        type: 'CREATE_WORK_ITEM',
        tempId: '$t1',
        parentId: '$fav',
        workType: 'TASK',
        title: 'Guardar favoritos',
        summary: 'x',
        acceptanceCriteria: ['ok'],
      },
      {
        type: 'CREATE_WORK_ITEM',
        tempId: '$t2',
        parentId: '$map_feat_1_2',
        workType: 'TASK',
        title: 'Completar la exportación a CSV',
        summary: 'Escapar comas.',
        acceptanceCriteria: ['ok'],
      },
      // The engine may not create or retouch what the map creates.
      { type: 'CREATE_MODULE', tempId: '$map_mod_1', title: 'Duplicado', summary: '', purpose: '' },
      { type: 'UPDATE_ENTITY_STATUS', entityId: '$map_feat_1_1', newStatus: 'ARCHIVED', reason: 'x' },
    ];
    return { draft: { title: 'Siguiente hito', rationale: 'Sobre el mapa.', operations }, assumptions: [], usage };
  }
  async exploreUi(): Promise<never> {
    throw new Error('no se usa');
  }
}

async function setup(base = mkdtempSync(join(tmpdir(), 'graphdev2-survey-'))) {
  if (!roots.includes(base)) roots.push(base);
  const repo = existsSync(join(base, 'tienda')) ? join(base, 'tienda') : shop(base);
  const engine = new MappedEngine(),
    surveyor = new FakeSurveyor(() => repo);
  const core = createWorkspaceCore(join(base, 'workspace'), () => undefined, {
    inceptionEngine: engine,
    repositorySurveyor: surveyor,
  });
  cores.push(core);
  const call = async <T>(channel: string, ...args: unknown[]) =>
    (await core.handle({ channel: channel as never, args })) as T;
  return { base, repo, engine, surveyor, core, call };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe('the map of what exists (plan REP, R3)', () => {
  it('reads the code while the user answers, the proposal waits for it and only adds new work; approving puts the map in the graph', async () => {
    const { repo, engine, surveyor, core, call } = await setup();
    const projectId = (await call<{ id: string }>('project:create', { name: 'Tienda', slug: 'tienda' })).id;
    await call('project:open', projectId);
    await call('repository:configure', projectId, repo);
    await call('inception:start', projectId, { brief: 'Quiero añadir favoritos' });
    await core.inceptionSettled(projectId);
    const asked = await call<InceptionViewDto>('inception:get', projectId);
    expect(asked.status).toBe('WAITING_USER');
    expect(asked.repository!.survey).toMatchObject({ status: 'RUNNING', survey: null });

    // The proposal waits for the survey.
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Una feature' }]);
    await tick();
    expect((await call<InceptionViewDto>('inception:get', projectId)).status).toBe('WORKING');
    expect(engine.proposed).toHaveLength(0);
    surveyor.release();
    await core.inceptionSettled(projectId);
    const proposed = await call<InceptionViewDto>('inception:get', projectId);
    expect(proposed).toMatchObject({ stage: 'PROPOSAL', status: 'WAITING_USER', nextAction: 'APPROVE', error: null });
    expect(surveyor.calls).toBe(1);

    // Only evidence that exists survives; a capability without it and an empty module are dropped.
    const map = proposed.repository!.survey!.survey!;
    expect(map.modules).toHaveLength(1);
    expect(map.modules[0]!.paths).toEqual(['src/catalog']);
    expect(map.modules[0]!.capabilities.map(item => [item.title, item.status, item.evidence])).toEqual([
      ['Listar productos', 'COMPLETE', ['src/catalog/catalog.js', 'tests/catalog.test.js']],
      ['Exportar a CSV', 'PARTIAL', ['src/export/csv.js']],
    ]);
    const prompt = buildProposalPrompt(engine.proposed[0]!, [], []);
    expect(prompt).toContain('<<<CODE_MAP');
    expect(prompt).toContain('"id":"$map_feat_1_2"');
    expect(prompt).toContain('«Fundación» is OPTIONAL');
    expect(prompt).not.toContain('NOT a scaffold from scratch');

    // What exists is shown apart from the new work; the partial capability appears in the plan with its task.
    expect(proposed.proposal!.existing).toEqual([
      {
        module: 'Catálogo',
        capabilities: [
          { title: 'Listar productos', status: 'COMPLETE' },
          { title: 'Exportar a CSV', status: 'PARTIAL' },
        ],
      },
    ]);
    expect(proposed.proposal!.features.map(feature => feature.title)).toEqual(['Favoritos', 'Exportar a CSV']);

    await call('inception:approve', projectId);
    const graph = await call<GraphViewDto>('graph:get_view', projectId);
    const node = (label: string) => graph.nodes.find(item => item.label === label)!;
    expect(graph.nodes.filter(item => item.type === 'MODULE').map(item => item.label)).toEqual(['Catálogo']);
    expect(node('Listar productos').status).toBe('DONE');
    expect(node('Exportar a CSV').status).toBe('PARTIAL');
    expect(node('Completar la exportación a CSV')).toMatchObject({
      status: 'READY',
      parentId: node('Exportar a CSV').id,
    });
    const code = graph.nodes
      .filter(item => item.type === 'CODE_REFERENCE')
      .map(item => item.label)
      .sort();
    expect(code).toEqual(['src/catalog/catalog.js', 'src/export/csv.js', 'tests/catalog.test.js']);
    const touches = graph.edges.filter(edge => edge.type === 'TOUCHES_CODE');
    expect(touches).toHaveLength(6); // each file from its capability and from its module
    expect(graph.edges.some(edge => edge.type === 'DOCUMENTED_BY' && edge.source === node('Catálogo').id)).toBe(true);
    const document = readFileSync(join(repo, 'docs/MAPA_DEL_CODIGO.md'), 'utf8');
    expect(document).toContain('## Catálogo');
    expect(document).toContain('**Exportar a CSV** (parcial)');
    expect(git(repo, 'status', '--porcelain')).toBe('');

    // A new task under the existing module gets the module's files as pointers (tier 4), not their contents.
    const preview = (await call('context:preview_package', {
      projectId,
      focusEntityId: node('Guardar favoritos').id,
      maxAllowedTokens: 32_000,
    })) as {
      packageText: string;
      snapshot: { includedSources: Array<{ titleOrPath: string; authorityTier: number }> };
    };
    const pointers = preview.snapshot.includedSources.filter(source => source.titleOrPath.startsWith('src/'));
    expect(pointers.map(source => source.titleOrPath).sort()).toEqual(['src/catalog/catalog.js', 'src/export/csv.js']);
    expect(pointers.every(source => source.authorityTier === 4)).toBe(true);
    expect(preview.packageText).toContain('Archivo src/catalog/catalog.js: código que ya existe');
    expect(preview.packageText).not.toContain('export const list');
  });

  it('a failed survey does not block the proposal (planned without the map); a restart stops a running one', async () => {
    const { repo, engine, surveyor, core, call } = await setup();
    const projectId = (await call<{ id: string }>('project:create', { name: 'Tienda', slug: 'tienda' })).id;
    await call('project:open', projectId);
    await call('repository:configure', projectId, repo);
    await call('inception:start', projectId, { brief: 'Favoritos' });
    await core.inceptionSettled(projectId);
    await call('inception:restart', projectId);
    expect(surveyor.signals[0]!.aborted).toBe(true);

    surveyor.fail = 'sin conexión';
    await call('inception:start', projectId, { brief: 'Favoritos' });
    await core.inceptionSettled(projectId);
    surveyor.release();
    await tick();
    const failed = await call<InceptionViewDto>('inception:get', projectId);
    expect(failed.repository!.survey).toMatchObject({ status: 'FAILED', error: 'sin conexión' });
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Una feature' }]);
    await core.inceptionSettled(projectId);
    expect(surveyor.calls).toBe(2);
    expect(engine.proposed[0]!.repository!.survey?.status).toBe('FAILED');
    expect(buildProposalPrompt(engine.proposed[0]!, [], [])).not.toContain('<<<CODE_MAP');
  });

  it('a survey cut short by closing the app reads as interrupted and runs again when the proposal is prepared', async () => {
    const first = await setup();
    const projectId = (await first.call<{ id: string }>('project:create', { name: 'Tienda', slug: 'tienda' })).id;
    await first.call('project:open', projectId);
    await first.call('repository:configure', projectId, first.repo);
    await first.call('inception:start', projectId, { brief: 'Favoritos' });
    await first.core.inceptionSettled(projectId);
    first.core.close();
    cores.splice(cores.indexOf(first.core), 1);

    const second = await setup(first.base);
    await second.call('project:open', projectId);
    const reopened = await second.call<InceptionViewDto>('inception:get', projectId);
    expect(reopened.repository!.survey).toMatchObject({ status: 'FAILED' });
    expect(reopened.repository!.survey!.error).toMatch(/interrumpió.*Se repetirá/);
    await second.call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Una feature' }]);
    await tick();
    expect(second.surveyor.calls).toBe(1);
    second.surveyor.release();
    await second.core.inceptionSettled(projectId);
    expect((await second.call<InceptionViewDto>('inception:get', projectId)).proposal!.existing).toHaveLength(1);
  });
});
