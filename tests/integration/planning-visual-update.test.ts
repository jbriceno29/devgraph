import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type {
  InceptionEnginePort,
  ReferenceTranslatorPort,
} from '../../src/modules/inception/application/ports/inception-port.js';
import type { ChangeSetPlannerPort } from '../../src/modules/planning/application/ports/change-set-planning-port.js';
import type { ChangeSetDto, GraphViewDto } from '../../src/shared/contracts/ipc-contracts.js';
import type { InceptionReferenceDto, InceptionViewDto } from '../../src/shared/contracts/inception-view.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import { UI_SPEC_SECTIONS } from '../../src/shared/ui-spec.js';
import { buildPlannerPrompt } from '../../src/modules/planning/infrastructure/change-set-planning-contract.js';
import { proposal, usage } from './inception-fixtures.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const spec = (extra = '', drop?: string) =>
  UI_SPEC_SECTIONS.filter(section => section !== drop)
    .map(section => `## ${section}\n\nContenido de ${section}.${section === 'Pantallas' ? extra : ''}`)
    .join('\n\n');
/** The inception of V2/V3, shortened: one direction, and the proposal carries the interface specification. */
const inceptionEngine: InceptionEnginePort = {
  askGoals: async () => ({
    questions: [{ id: 'q1', text: '¿Quién?', options: ['Yo'], default: 'Yo', why: 'Alcance.' }],
    assumptions: [],
    usage,
  }),
  exploreUi: async () => ({
    options: [
      {
        title: 'Panel',
        summary: 'Claro.',
        navigation: 'Lateral.',
        screens: ['Inicio'],
        designSystemNotes: ['#2255ff'],
        prototypeHtml: `<!doctype html><html><body><main>${'x'.repeat(300)}</main></body></html>`,
      },
    ],
    assumptions: [],
    usage,
  }),
  propose: async input => {
    const operations: ChangeOperation[] = proposal().map(op =>
      op.type === 'CREATE_RELATIONSHIP' && op.targetId === 'ROOT' ? { ...op, targetId: input.project.rootId } : op,
    );
    if (input.project.direction)
      operations.push({
        type: 'UPSERT_ARTIFACT',
        tempId: '$ui_spec',
        parentId: null,
        artifactType: 'SPEC',
        title: 'Especificación de interfaz',
        relativePath: 'docs/UI_SPEC.md',
        markdownContent: spec(),
      });
    return { draft: { title: 'Inicio', rationale: 'Simple.', operations }, assumptions: [], usage };
  },
};
/** Describes every file as a VISUAL reference would be, plus screens a VISUAL reference must never contribute. */
class Translator implements ReferenceTranslatorPort {
  seen: Array<{ id: string; kind: string; existed: boolean }> = [];
  async translate(input: Parameters<ReferenceTranslatorPort['translate']>[0]) {
    this.seen.push(...input.files.map(file => ({ id: file.id, kind: file.kind, existed: existsSync(file.path) })));
    return {
      results: input.files.map(file => ({
        id: file.id,
        error: null,
        translation: {
          summary: 'Carrito lateral verde.',
          palette: ['Verde #0f766e'],
          typography: 'Inter',
          layout: 'Panel lateral',
          screens: [],
          actions: [],
          flows: [],
          states: [],
          ideas: [],
          openQuestions: [],
        },
      })),
      usage,
    };
  }
}
/** Records what the planner receives and answers with whatever the test sets. */
class Planner implements ChangeSetPlannerPort {
  inputs: Array<Parameters<ChangeSetPlannerPort['propose']>[0]> = [];
  next: (input: Parameters<ChangeSetPlannerPort['propose']>[0]) => ChangeOperation[] = () => [];
  async propose(input: Parameters<ChangeSetPlannerPort['propose']>[0]) {
    this.inputs.push(input);
    return { title: 'Carrito', rationale: 'Nueva feature.', operations: this.next(input) };
  }
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');

async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'graphdev2-plan-visual-'));
  roots.push(base);
  const translator = new Translator(),
    planner = new Planner();
  const core = createWorkspaceCore(join(base, 'workspace'), () => undefined, {
    inceptionEngine,
    referenceTranslator: translator,
    changeSetPlanner: planner,
  });
  cores.push(core);
  const projectId = (
    (await core.handle({ channel: 'project:create', args: [{ name: 'Tienda', slug: 'tienda' }] })) as { id: string }
  ).id;
  await core.handle({ channel: 'project:open', args: [projectId] });
  const call = async <T>(channel: string, ...args: unknown[]) =>
    (await core.handle({ channel: channel as never, args })) as T;
  const settled = async () => {
    await core.inceptionSettled(projectId);
    return call<InceptionViewDto>('inception:get', projectId);
  };
  // A project in progress: the inception with an approved design left docs/UI_SPEC.md linked to every feature.
  const repo = join(base, 'repo');
  await call('repository:initialize', projectId, repo);
  await call('inception:start', projectId, { brief: 'Una tienda' });
  await settled();
  await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Yo' }], undefined, { exploreUi: true });
  await settled();
  await call('inception:choose_ui', projectId, 'ui-1');
  await settled();
  expect(await call<InceptionViewDto>('inception:approve', projectId)).toMatchObject({ stage: 'APPLIED' });
  const graph = await call<GraphViewDto>('graph:get_view', projectId);
  const moduleId = graph.nodes.find(node => node.type === 'MODULE')!.id,
    specId = graph.nodes.find(node => node.type === 'ARTIFACT' && node.label === 'Especificación de interfaz')!.id;
  return { base, repo, translator, planner, projectId, call, moduleId, specId };
}
const feature = (moduleId: string): ChangeOperation[] => [
  {
    type: 'CREATE_FEATURE',
    tempId: '$cart',
    moduleId,
    title: 'Carrito',
    summary: 'Añadir y quitar productos.',
    scope: 'Web',
    priority: 'HIGH',
  },
  {
    type: 'CREATE_WORK_ITEM',
    tempId: '$cart_ui',
    parentId: '$cart',
    workType: 'TASK',
    title: 'Panel del carrito',
    summary: 'Panel lateral.',
    acceptanceCriteria: ['Se ve el total'],
  },
];

describe('updating the interface while planning a feature on a project in progress (V4)', () => {
  it('attached references are translated (files gone afterwards) and the updated UI_SPEC keeps its sections, becomes an update and is linked to the new feature', async () => {
    const { base, repo, translator, planner, projectId, call, moduleId, specId } = await setup();
    const translated = await call<InceptionReferenceDto[]>('planning:translate_references', projectId, [
      { name: 'carrito.png', kind: 'VISUAL', note: 'el verde', dataBase64: PNG },
    ]);
    expect(translated).toEqual([
      expect.objectContaining({ id: 'ref-1', name: 'carrito.png', kind: 'VISUAL', status: 'TRANSLATED', error: null }),
    ]);
    expect(translator.seen).toEqual([{ id: 'ref-1', kind: 'VISUAL', existed: true }]);
    const folder = join(base, 'workspace', 'projects', projectId, 'planning', 'references');
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    await expect(
      call('planning:translate_references', projectId, [
        { name: 'x.png', kind: 'VISUAL', dataBase64: Buffer.from('no').toString('base64') },
      ]),
    ).rejects.toThrow(/no es un archivo .png válido/);

    // The model writes the specification as a new document (tempId): the app turns it into an update of the existing one.
    planner.next = () => [
      ...feature(moduleId),
      {
        type: 'UPSERT_ARTIFACT',
        tempId: '$spec',
        parentId: null,
        artifactType: 'SPEC',
        title: 'Especificación de interfaz',
        relativePath: 'docs/UI_SPEC.md',
        markdownContent: spec('\n\n- Carrito: panel lateral verde.'),
      },
    ];
    const sentReference = {
      ...translated[0]!,
      translation: { ...translated[0]!.translation!, screens: ['Pago con tarjeta'] },
    };
    const changeSet = await call<ChangeSetDto>(
      'changeset:propose_from_chat',
      projectId,
      'Añade un carrito',
      undefined,
      undefined,
      undefined,
      { references: [sentReference], updateUiSpec: true },
    );
    const input = planner.inputs[0]!;
    expect(input.uiSpec).toEqual({
      entityId: specId,
      content: readFileSync(join(repo, 'docs', 'UI_SPEC.md'), 'utf8'),
      update: true,
    });
    // What the renderer sends back is normalized again: a VISUAL reference never brings screens.
    expect(input.references).toEqual([
      {
        kind: 'VISUAL',
        name: 'carrito.png',
        note: 'el verde',
        translation: expect.objectContaining({ summary: 'Carrito lateral verde.', screens: [] }),
      },
    ]);
    const prompt = buildPlannerPrompt(input);
    expect(prompt).toContain('<<<USER_REFERENCES');
    expect(prompt).toContain('<<<CURRENT_UI_SPEC');
    expect(prompt).toContain(`entityId "${specId}"`);
    expect(changeSet.status).toBe('VALIDATED');
    expect(changeSet.rationale).toContain('Referencias usadas: «carrito.png» (cómo debe verse)');
    expect(changeSet.operations).toContainEqual(
      expect.objectContaining({ type: 'UPSERT_ARTIFACT', entityId: specId, relativePath: 'docs/UI_SPEC.md' }),
    );
    expect(changeSet.operations.some(op => op.type === 'UPSERT_ARTIFACT' && 'tempId' in op)).toBe(false);
    expect(changeSet.operations).toContainEqual({
      type: 'CREATE_RELATIONSHIP',
      sourceId: '$cart',
      targetId: specId,
      edgeType: 'DOCUMENTED_BY',
    });

    await call('changeset:apply', changeSet.id);
    const written = readFileSync(join(repo, 'docs', 'UI_SPEC.md'), 'utf8');
    expect(written).toContain('Carrito: panel lateral verde');
    for (const section of UI_SPEC_SECTIONS) expect(written).toContain(`## ${section}`);
    // Committed like every document a ChangeSet writes (the prototype of V3 is left for the user to commit).
    expect(
      execFileSync('git', ['status', '--porcelain', '--', 'docs/UI_SPEC.md'], { cwd: repo, encoding: 'utf8' }),
    ).toBe('');
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' })).toContain('Carrito');
    // One document only, and the new task's agent receives it (level 3, through the feature).
    const graph = await call<GraphViewDto>('graph:get_view', projectId);
    expect(
      graph.nodes.filter(node => node.type === 'ARTIFACT' && node.label === 'Especificación de interfaz'),
    ).toHaveLength(1);
    const task = graph.nodes.find(node => node.type === 'WORK_ITEM' && node.label === 'Panel del carrito')!;
    const context = await call<{
      snapshot: { includedSources: Array<{ sourceId: string; authorityTier: number; extractedContent: string }> };
    }>('context:preview_package', { projectId, focusEntityId: task.id });
    expect(context.snapshot.includedSources.find(source => source.sourceId === specId)).toMatchObject({
      authorityTier: 3,
    });
  });

  it('without asking for it the specification is left alone, but new features are still linked to it', async () => {
    const { planner, projectId, call, moduleId, specId } = await setup();
    planner.next = () => feature(moduleId);
    const changeSet = await call<ChangeSetDto>('changeset:propose_from_chat', projectId, 'Añade un carrito');
    expect(planner.inputs[0]!.uiSpec).toEqual({ entityId: specId, content: null, update: false });
    expect(buildPlannerPrompt(planner.inputs[0]!)).toContain('do not include it in this proposal');
    expect(changeSet.status).toBe('VALIDATED');
    expect(changeSet.operations).toContainEqual({
      type: 'CREATE_RELATIONSHIP',
      sourceId: '$cart',
      targetId: specId,
      edgeType: 'DOCUMENTED_BY',
    });
  });

  it('a proposal that would break the specification, or leaves it out when it was asked for, cannot be applied', async () => {
    const { repo, planner, projectId, call, moduleId, specId } = await setup();
    const before = readFileSync(join(repo, 'docs', 'UI_SPEC.md'), 'utf8');
    planner.next = () => [
      ...feature(moduleId),
      {
        type: 'UPSERT_ARTIFACT',
        entityId: specId,
        artifactType: 'SPEC',
        title: 'Especificación de interfaz',
        relativePath: 'docs/UI_SPEC.md',
        markdownContent: spec('', 'Estados de UI'),
      },
    ];
    const broken = await call<ChangeSetDto>(
      'changeset:propose_from_chat',
      projectId,
      'Añade un carrito',
      undefined,
      undefined,
      undefined,
      { updateUiSpec: true },
    );
    expect(broken.status).toBe('PENDING_APPROVAL');
    expect(broken.validationIssues).toContainEqual(
      expect.objectContaining({ code: 'UI_SPEC_SECTIONS', message: expect.stringContaining('Estados de UI') }),
    );
    await expect(call('changeset:apply', broken.id)).rejects.toThrow(/Valida la propuesta/);
    // Fixing it by hand is validated the same way.
    await expect(call<ChangeSetDto>('changeset:edit', broken.id, broken.operations)).resolves.toMatchObject({
      status: 'PENDING_APPROVAL',
    });
    planner.next = () => feature(moduleId);
    const missing = await call<ChangeSetDto>(
      'changeset:propose_from_chat',
      projectId,
      'Añade un carrito',
      undefined,
      undefined,
      undefined,
      { updateUiSpec: true },
    );
    expect(missing.status).toBe('PENDING_APPROVAL');
    expect(missing.validationIssues).toContainEqual(expect.objectContaining({ code: 'UI_SPEC_MISSING' }));
    expect(readFileSync(join(repo, 'docs', 'UI_SPEC.md'), 'utf8')).toBe(before);
    await expect(
      call('changeset:propose_from_chat', projectId, 'x', undefined, undefined, undefined, {
        references: [{ name: 'a', kind: 'OTRO', note: '', translation: {} }],
      }),
    ).rejects.toThrow(/visual, funcional o conceptual/);
  });
});
