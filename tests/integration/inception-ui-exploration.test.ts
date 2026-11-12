import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import { openDatabase, closeDatabase } from '../../src/infrastructure/persistence/sqlite/database.js';
import type {
  InceptionEnginePort,
  InceptionProjectInput,
  ReferenceTranslatorPort,
  UiOptionDraft,
} from '../../src/application/ports/inception-port.js';
import type { ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';
import { MAX_PROTOTYPE_CHARS, type InceptionViewDto } from '../../src/shared/contracts/inception-view.js';
import { proposal, usage } from './inception-fixtures.js';
import type { ChangeOperation } from '../../src/domain/knowledge/change-set.js';
import { UI_SPEC_SECTIONS } from '../../src/shared/ui-spec.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const page = (title: string, extra = '') =>
  `<!doctype html><html><head><title>${title}</title><style>body{font-family:sans-serif}</style></head><body><h1>${title}</h1><main><ul><li>Tarea uno</li></ul></main><script>document.title='${title}';</script>${extra}</body></html>`;
const draft = (title: string, html = page(title)): UiOptionDraft => ({
  title,
  summary: `${title}: resumen.`,
  navigation: 'Barra lateral.',
  screens: ['Inicio', 'Tareas'],
  designSystemNotes: ['Azul #2255ff'],
  prototypeHtml: html,
});

class FakeEngine implements InceptionEnginePort {
  explored: Array<{
    models: string | undefined;
    revise: boolean;
    project: InceptionProjectInput;
    notes?: string[];
    option?: UiOptionDraft;
  }> = [];
  proposed: InceptionProjectInput[] = [];
  failExplore = false;
  failPropose = false;
  hang = false;
  reviseTitle = 'Panel ajustado';
  omitSpec = false;
  async askGoals() {
    return {
      questions: [{ id: 'q1', text: '¿Quién la usa?', options: ['Solo yo'], default: 'Solo yo', why: 'Alcance.' }],
      assumptions: [],
      usage,
    };
  }
  async exploreUi(input: Parameters<InceptionEnginePort['exploreUi']>[0]) {
    this.explored.push({
      models: input.model,
      revise: Boolean(input.revise),
      project: input.project,
      ...(input.revise ? { notes: input.revise.notes, option: input.revise.option } : {}),
    });
    if (this.hang)
      await new Promise((_resolve, reject) =>
        input.signal?.addEventListener('abort', () => reject(new Error('cancelada')), { once: true }),
      );
    if (this.failExplore) throw new Error('motor de diseño caído');
    if (input.revise)
      return {
        options: [draft(this.reviseTitle, page(this.reviseTitle, `<!-- notas: ${input.revise.notes.join('|')} -->`))],
        assumptions: [],
        usage,
      };
    return {
      options: [
        draft('Panel claro', page('Panel claro', '<link href="https://cdn.example.com/x.css">')),
        draft('Lista minimalista'),
      ],
      assumptions: ['Interfaz web'],
      usage,
    };
  }
  async propose(input: Parameters<InceptionEnginePort['propose']>[0]) {
    this.proposed.push(input.project);
    if (this.failPropose) throw new Error('propuesta caída');
    const operations: ChangeOperation[] = proposal().map(op =>
      op.type === 'CREATE_RELATIONSHIP' && op.targetId === 'ROOT' ? { ...op, targetId: input.project.rootId } : op,
    );
    // Like the real engine, a proposal built on an approved direction carries the interface specification.
    if (input.project.direction && !this.omitSpec)
      operations.push({
        type: 'UPSERT_ARTIFACT',
        tempId: '$ui_spec',
        parentId: null,
        artifactType: 'SPEC',
        title: 'Especificación de interfaz',
        relativePath: 'docs/UI_SPEC.md',
        markdownContent: UI_SPEC_SECTIONS.map(section => `## ${section}\n\nContenido de ${section}.`).join('\n\n'),
      });
    return { draft: { title: 'Inicio: tareas', rationale: 'Simple.', operations }, assumptions: [], usage };
  }
}

/** Describes any image as a blue two-column panel, or fails when asked to; records what it was given. */
class FakeTranslator implements ReferenceTranslatorPort {
  calls: Array<Array<{ id: string; kind: string; mimeType: string; exists: boolean }>> = [];
  fail = false;
  async translate(input: Parameters<ReferenceTranslatorPort['translate']>[0]) {
    this.calls.push(
      input.files.map(file => ({
        id: file.id,
        kind: file.kind,
        mimeType: file.mimeType,
        exists: existsSync(file.path),
      })),
    );
    if (this.fail)
      return { results: input.files.map(file => ({ id: file.id, translation: null, error: 'No se ve nada.' })), usage };
    return {
      results: input.files.map(file => ({
        id: file.id,
        error: null,
        translation: {
          summary: 'Panel azul con barra lateral.',
          palette: ['Azul #2255ff'],
          typography: 'Inter',
          layout: 'Dos columnas',
          screens: ['Inicio', 'Ajustes'],
          actions: ['Crear'],
          flows: ['Crear → listar'],
          states: ['vacío'],
          ideas: [],
          openQuestions: [],
        },
      })),
      usage,
    };
  }
}
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
const REACT_SOURCE =
  "import { useState } from 'react';\nexport default function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>Tareas: {n}</button>; }";

async function setup(
  root = mkdtempSync(join(tmpdir(), 'graphdev2-ui-explore-')),
  engine = new FakeEngine(),
  existing?: string,
  translator = new FakeTranslator(),
) {
  if (!existing) roots.push(root);
  const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, {
    inceptionEngine: engine,
    referenceTranslator: translator,
  });
  cores.push(core);
  const projectId =
    existing ??
    ((await core.handle({ channel: 'project:create', args: [{ name: 'Tareas', slug: 'tareas' }] })) as { id: string })
      .id;
  await core.handle({ channel: 'project:open', args: [projectId] });
  const call = async <T>(channel: string, ...args: unknown[]) =>
    (await core.handle({ channel: channel as never, args })) as T;
  const settled = async () => {
    await core.inceptionSettled(projectId);
    return call<InceptionViewDto>('inception:get', projectId);
  };
  /** Brief → questions → answers with the design step requested → directions to choose from. */
  const toExploring = async () => {
    await call('inception:start', projectId, { brief: 'Un panel de tareas' });
    await settled();
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, {
      exploreUi: true,
    });
    return settled();
  };
  return { root, core, engine, translator, projectId, call, settled, toExploring };
}

describe('visual exploration before the proposal (V2)', () => {
  it('asks for directions after the answers, keeps the prototypes out of the view and serves each one apart', async () => {
    const { engine, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Un panel de tareas' });
    await settled();
    const working = await call<InceptionViewDto>(
      'inception:answer',
      projectId,
      [{ questionId: 'q1', answer: 'Solo yo' }],
      undefined,
      { exploreUi: true },
    );
    expect(working).toMatchObject({ stage: 'ASK_GOALS', status: 'WORKING', ui: { wanted: true, options: [] } });
    const view = await settled();
    expect(view).toMatchObject({
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      nextAction: 'CHOOSE_UI',
      error: null,
      ui: { wanted: true, selectedOptionId: null },
    });
    expect(view.ui.options.map(option => [option.id, option.title, option.source, option.screens])).toEqual([
      ['ui-1', 'Panel claro', 'GENERATED', ['Inicio', 'Tareas']],
      ['ui-2', 'Lista minimalista', 'GENERATED', ['Inicio', 'Tareas']],
    ]);
    expect(view.ui.options[0]!.externalReferences).toEqual(['cdn.example.com']);
    expect(view.ui.options[1]!.externalReferences).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('<!doctype');
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-2')).toBe(page('Lista minimalista'));
    await expect(call('inception:get_ui_prototype', projectId, 'ui-9')).rejects.toThrow('ya no existe');
    // The design model is a design-capable one, not the (expensive) planning model; it gets the answers' context.
    expect(engine.explored).toHaveLength(1);
    expect(engine.explored[0]!.models).toBe('sonnet');
    expect(view.assumptions).toContain('Interfaz web');
  });

  it('imports a prototype made elsewhere as one more direction, and refuses what is not HTML, too big or too many', async () => {
    const { projectId, call, toExploring } = await setup();
    await toExploring();
    const imported = await call<InceptionViewDto>('inception:import_prototype', projectId, {
      name: 'C:\\descargas\\mi-diseño.html',
      html: page('Mi diseño de Artifacts', '<script src="https://cdn.example.com/lib.js"></script>'),
    });
    expect(imported.ui.options.at(-1)).toMatchObject({
      id: 'ui-3',
      title: 'Mi diseño de Artifacts',
      source: 'IMPORTED',
      externalReferences: ['cdn.example.com'],
    });
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-3')).toContain('Mi diseño de Artifacts');
    const untitled = await call<InceptionViewDto>('inception:import_prototype', projectId, {
      name: 'boceto-final.html',
      html: '<div><p>hola</p></div>',
    });
    expect(untitled.ui.options.at(-1)).toMatchObject({ id: 'ui-4', title: 'boceto-final' });
    await expect(call('inception:import_prototype', projectId, { name: 'a.html', html: '   ' })).rejects.toThrow(
      'está vacío',
    );
    await expect(
      call('inception:import_prototype', projectId, { name: 'a.html', html: 'solo texto, sin etiquetas' }),
    ).rejects.toThrow('no parece un documento HTML');
    await expect(
      call('inception:import_prototype', projectId, {
        name: 'a.html',
        html: `<div>${'x'.repeat(MAX_PROTOTYPE_CHARS)}</div>`,
      }),
    ).rejects.toThrow('supera');
    await call('inception:import_prototype', projectId, { name: 'quinta.html', html: '<main>5</main>' });
    await expect(
      call('inception:import_prototype', projectId, { name: 'sexta.html', html: '<main>6</main>' }),
    ).rejects.toThrow('como mucho 5 direcciones');
  });

  it('adjusts one direction with the user notes and leaves the others; a failure keeps everything and says why', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    const working = await call<InceptionViewDto>('inception:revise_ui', projectId, 'ui-1', 'Barra lateral más angosta');
    expect(working.status).toBe('WORKING');
    const revised = await settled();
    expect(revised).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', error: null });
    expect(revised.ui.options.map(option => [option.id, option.title])).toEqual([
      ['ui-1', 'Panel ajustado'],
      ['ui-2', 'Lista minimalista'],
    ]);
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-1')).toContain(
      'notas: Barra lateral más angosta',
    );
    expect(engine.explored.at(-1)).toMatchObject({ revise: true, notes: ['Barra lateral más angosta'] });
    // A failed adjustment leaves the options as they were, with the reason, still choosing.
    engine.failExplore = true;
    await call('inception:revise_ui', projectId, 'ui-2', 'Más colorido');
    const failed = await settled();
    expect(failed).toMatchObject({
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      nextAction: 'CHOOSE_UI',
      error: 'motor de diseño caído',
    });
    expect(failed.ui.options.map(option => option.title)).toEqual(['Panel ajustado', 'Lista minimalista']);
    engine.failExplore = false;
    await call('inception:revise_ui', projectId, 'ui-2', 'Más colorido');
    expect((await settled()).error).toBeNull();
    await expect(call('inception:revise_ui', projectId, 'ui-2', '  ')).rejects.toThrow('qué quieres cambiar');
    await expect(call('inception:revise_ui', projectId, 'ui-9', 'x')).rejects.toThrow('ya no existe');
    await expect(call('inception:revise_ui', projectId, 'ui-2', 'x'.repeat(2001))).rejects.toThrow('como mucho 2000');
  });

  it('approving a direction builds the proposal on it: written details for a generated one, the HTML for an imported one', async () => {
    const generated = await setup();
    await generated.toExploring();
    const choosing = await generated.call<InceptionViewDto>('inception:choose_ui', generated.projectId, 'ui-1');
    expect(choosing).toMatchObject({ stage: 'PROPOSAL', status: 'WORKING', ui: { selectedOptionId: 'ui-1' } });
    const proposed = await generated.settled();
    expect(proposed).toMatchObject({ stage: 'PROPOSAL', status: 'WAITING_USER', ui: { selectedOptionId: 'ui-1' } });
    expect(generated.engine.proposed[0]!.direction).toEqual({
      title: 'Panel claro',
      summary: 'Panel claro: resumen.',
      navigation: 'Barra lateral.',
      screens: ['Inicio', 'Tareas'],
      designSystemNotes: ['Azul #2255ff'],
      source: 'GENERATED',
    });

    const imported = await setup();
    await imported.toExploring();
    await imported.call('inception:import_prototype', imported.projectId, { name: 'mio.html', html: page('Mío') });
    await imported.call('inception:choose_ui', imported.projectId, 'ui-3');
    await imported.settled();
    expect(imported.engine.proposed[0]!.direction).toMatchObject({
      title: 'Mío',
      source: 'IMPORTED',
      prototypeHtml: page('Mío'),
    });
  });

  it('skipping the design goes straight to the plan, with no direction', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, null);
    const view = await settled();
    expect(view).toMatchObject({
      stage: 'PROPOSAL',
      status: 'WAITING_USER',
      ui: { wanted: true, selectedOptionId: null },
    });
    expect(engine.proposed[0]).not.toHaveProperty('direction');
    // Changing the answers later regenerates the proposal and keeps the chosen direction.
  });

  it('regenerating the proposal after choosing keeps the approved direction', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, 'ui-2');
    await settled();
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Un equipo' }], 'Usa Python');
    await settled();
    expect(engine.proposed).toHaveLength(2);
    expect(engine.proposed[1]!.direction).toMatchObject({ title: 'Lista minimalista', source: 'GENERATED' });
  });

  it('a proposal that fails after choosing brings the user back to the directions, with the reason and the selection kept', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    engine.failPropose = true;
    await call('inception:choose_ui', projectId, 'ui-1');
    const failed = await settled();
    expect(failed).toMatchObject({
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      nextAction: 'CHOOSE_UI',
      error: 'propuesta caída',
      ui: { selectedOptionId: 'ui-1' },
    });
    expect(failed.ui.options).toHaveLength(2);
    engine.failPropose = false;
    await call('inception:choose_ui', projectId, 'ui-1');
    expect(await settled()).toMatchObject({ stage: 'PROPOSAL', status: 'WAITING_USER', error: null });
  });

  it('V3: the approved design leaves docs/UI_SPEC.md linked to every feature and the prototype itself in docs/design/prototype.html', async () => {
    const { root, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, 'ui-2');
    await settled();
    const repo = join(root, 'repo-v3');
    await call('repository:initialize', projectId, repo);
    expect(await call<InceptionViewDto>('inception:approve', projectId)).toMatchObject({
      stage: 'APPLIED',
      error: null,
    });
    const spec = readFileSync(join(repo, 'docs', 'UI_SPEC.md'), 'utf8');
    for (const section of UI_SPEC_SECTIONS) expect(spec).toContain(`## ${section}`);
    expect(readFileSync(join(repo, 'docs', 'design', 'prototype.html'), 'utf8')).toBe(page('Lista minimalista'));
    const db = openDatabase({
      filename: join(root, 'workspace', 'projects', projectId, 'workspace.sqlite'),
      initialize: false,
    });
    try {
      const linked = db
        .prepare(
          "SELECT s.display_key AS feature FROM graph_edges e JOIN knowledge_entities s ON s.id=e.source_id JOIN knowledge_entities t ON t.id=e.target_id JOIN artifacts a ON a.entity_id=t.id WHERE e.edge_type='DOCUMENTED_BY' AND a.relative_path='docs/UI_SPEC.md' AND s.entity_type='FEATURE'",
        )
        .all() as Array<{ feature: string }>;
      expect(linked).toHaveLength(
        (db.prepare("SELECT COUNT(*) AS n FROM knowledge_entities WHERE entity_type='FEATURE'").get() as { n: number })
          .n,
      );
    } finally {
      closeDatabase(db);
    }
  });

  it('V3: a proposal that leaves out docs/UI_SPEC.md is reported as incomplete and cannot be approved; without a design nothing extra is demanded', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    engine.omitSpec = true;
    await call('inception:choose_ui', projectId, 'ui-1');
    const view = await settled();
    expect(view.error).toContain('docs/UI_SPEC.md');
    await expect(call('inception:approve', projectId)).rejects.toThrow('incompleta');
    // Skipping the design needs no specification.
    const skipped = await setup();
    await skipped.toExploring();
    skipped.engine.omitSpec = true;
    await skipped.call('inception:choose_ui', skipped.projectId, null);
    expect((await skipped.settled()).error).toBeNull();
  });

  it('a failed generation can be retried with the same request, and nothing else is offered', async () => {
    const { engine, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Un panel' });
    await settled();
    engine.failExplore = true;
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, {
      exploreUi: true,
    });
    const failed = await settled();
    expect(failed).toMatchObject({
      stage: 'ASK_GOALS',
      status: 'FAILED',
      nextAction: 'RETRY_UI',
      error: 'motor de diseño caído',
      ui: { wanted: true, options: [] },
    });
    engine.failExplore = false;
    // What the retry button sends; a plain retry without the option keeps the request too.
    await call('inception:answer', projectId, failed.answers, undefined, { exploreUi: true });
    expect(await settled()).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER' });
  });

  it('refuses actions out of turn', async () => {
    const { projectId, call, settled, toExploring } = await setup();
    await expect(call('inception:choose_ui', projectId, null))
      .rejects.toThrow('Empieza')
      .catch(async () => expect(call('inception:choose_ui', projectId, null)).rejects.toThrow());
    await call('inception:start', projectId, { brief: 'Un panel' });
    await settled();
    await expect(call('inception:choose_ui', projectId, null)).rejects.toThrow(
      'No estás eligiendo una dirección visual',
    );
    await expect(
      call('inception:import_prototype', projectId, { name: 'a.html', html: '<div>x</div>' }),
    ).rejects.toThrow('No estás eligiendo');
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, {
      exploreUi: true,
    });
    await settled();
    await expect(call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }])).rejects.toThrow(
      'Elige una dirección visual',
    );
    await expect(call('inception:choose_ui', projectId, 'ui-9')).rejects.toThrow('ya no existe');
    void toExploring;
  });

  it('shows up in the activity inbox as something the user must decide', async () => {
    const { projectId, call, toExploring } = await setup();
    await toExploring();
    const activity = await call<ActivitySummaryDto>('activity:list', projectId);
    expect(activity.inception).toMatchObject({
      stage: 'EXPLORE_UI',
      needsAttention: true,
      title: 'Inicio del proyecto: elige una dirección visual',
    });
  });

  it('restart forgets the directions', async () => {
    const { projectId, call, toExploring } = await setup();
    await toExploring();
    expect(await call<InceptionViewDto>('inception:restart', projectId)).toMatchObject({
      stage: 'NOT_STARTED',
      ui: { wanted: false, options: [], selectedOptionId: null },
    });
  });
});

describe('the whole path with a design, from the brief to the applied plan (V2 acceptance)', () => {
  it('questions → design → import, adjust, approve → proposal → repository → approve: the plan is created and the choice survives', async () => {
    const { root, engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:import_prototype', projectId, { name: 'mio.html', html: page('Mío') });
    await call('inception:revise_ui', projectId, 'ui-3', 'Más aire entre filas');
    await settled();
    await call('inception:choose_ui', projectId, 'ui-3');
    const proposed = await settled();
    expect(proposed).toMatchObject({
      stage: 'PROPOSAL',
      status: 'WAITING_USER',
      nextAction: 'SET_UP_REPOSITORY',
      ui: { wanted: true, selectedOptionId: 'ui-3' },
    });
    expect(engine.proposed[0]!.direction).toMatchObject({ title: 'Panel ajustado', source: 'IMPORTED' });
    const repo = join(root, 'nuevo-repo');
    await call('repository:initialize', projectId, repo);
    const applied = await call<InceptionViewDto>('inception:approve', projectId);
    expect(applied).toMatchObject({ stage: 'APPLIED', status: 'DONE', nextAction: 'DONE', error: null });
    // The plan exists, the documents are in the repository, and the approved direction is still on record.
    expect(existsSync(join(repo, 'docs', 'VISION.md'))).toBe(true);
    expect(readFileSync(join(repo, 'docs', 'VISION.md'), 'utf8')).toContain('Visión');
    const db = openDatabase({
      filename: join(root, 'workspace', 'projects', projectId, 'workspace.sqlite'),
      initialize: false,
    });
    try {
      expect(
        (
          db.prepare("SELECT COUNT(*) AS n FROM knowledge_entities WHERE entity_type='WORK_ITEM'").get() as {
            n: number;
          }
        ).n,
      ).toBe(4);
    } finally {
      closeDatabase(db);
    }
    expect(applied.ui).toMatchObject({ wanted: true, selectedOptionId: 'ui-3' });
    expect(applied.ui.options).toHaveLength(3);
    // Once applied there is no way back: the design can no longer be reopened or changed from the assistant.
    await expect(call('inception:reopen_design', projectId)).rejects.toThrow('mientras revisas la propuesta');
    await expect(call('inception:choose_ui', projectId, 'ui-1')).rejects.toThrow('No estás eligiendo');
    expect((await call<ActivitySummaryDto>('activity:list', projectId)).inception).toBeUndefined();
  });

  it('skipping the design reaches the same applied plan without a direction', async () => {
    const { root, engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, null);
    await settled();
    await call('repository:initialize', projectId, join(root, 'repo'));
    expect(await call<InceptionViewDto>('inception:approve', projectId)).toMatchObject({
      stage: 'APPLIED',
      ui: { selectedOptionId: null },
    });
    expect(engine.proposed[0]).not.toHaveProperty('direction');
  });
});

describe('importing a finished design: an image or React code (V2 fix)', () => {
  it('an image is described in text by the translator and becomes a direction with no prototype; its page is built on request', async () => {
    const { translator, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    const working = await call<InceptionViewDto>('inception:import_design', projectId, {
      name: 'C:\\fotos\\mi-diseño.png',
      kind: 'IMAGE',
      content: PNG_B64,
    });
    expect(working.status).toBe('WORKING');
    const view = await settled();
    expect(view).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', error: null });
    expect(view.ui.options.at(-1)).toEqual({
      id: 'ui-3',
      title: 'mi-diseño',
      summary: 'Panel azul con barra lateral.',
      navigation: 'Crear → listar',
      screens: ['Inicio', 'Ajustes'],
      designSystemNotes: ['Paleta: Azul #2255ff', 'Tipografía: Inter', 'Composición: Dos columnas', 'Estado: vacío'],
      source: 'IMAGE',
      htmlBytes: 12,
      externalReferences: [],
    });
    expect(JSON.stringify(view)).not.toMatch(/imageFile|design-3|iVBOR/);
    // The translator got the stored copy as a DESIGN (looks and behaviour), not as one of the three reference kinds.
    expect(translator.calls).toEqual([[{ id: 'design-3', kind: 'DESIGN', mimeType: 'image/png', exists: true }]]);
    const page = await call<string>('inception:get_ui_prototype', projectId, 'ui-3');
    expect(page).toContain(`<img alt="Imagen del diseño importado" src="data:image/png;base64,${PNG_B64}">`);
    expect(page).not.toMatch(/<script/i);
  });

  it('a picture the translator cannot read leaves the directions as they were, with the reason', async () => {
    const { translator, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    translator.fail = true;
    await call('inception:import_design', projectId, { name: 'vacia.png', kind: 'IMAGE', content: PNG_B64 });
    const failed = await settled();
    expect(failed).toMatchObject({
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      nextAction: 'CHOOSE_UI',
      error: 'No se pudo analizar «vacia.png»: No se ve nada.',
    });
    expect(failed.ui.options).toHaveLength(2);
  });

  it('approving an image direction builds the proposal on its written description, never on the picture', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:import_design', projectId, { name: 'diseno.png', kind: 'IMAGE', content: PNG_B64 });
    await settled();
    await call('inception:choose_ui', projectId, 'ui-3');
    await settled();
    const direction = engine.proposed[0]!.direction!;
    expect(direction).toMatchObject({
      title: 'diseno',
      summary: 'Panel azul con barra lateral.',
      screens: ['Inicio', 'Ajustes'],
      source: 'GENERATED',
    });
    expect(direction).not.toHaveProperty('prototypeHtml');
    expect(JSON.stringify(engine.proposed[0])).not.toContain('iVBOR');
  });

  it('adjusting an image direction asks the engine to build the prototype from its description, and it stops being an image', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:import_design', projectId, { name: 'diseno.png', kind: 'IMAGE', content: PNG_B64 });
    await settled();
    await call('inception:revise_ui', projectId, 'ui-3', 'Conviértelo en un prototipo interactivo fiel a este diseño.');
    const view = await settled();
    const call3 = engine.explored.at(-1)!;
    expect(call3.option).toMatchObject({ title: 'diseno', prototypeHtml: '', screens: ['Inicio', 'Ajustes'] });
    expect(call3.notes![0]).toMatch(
      /^Esta dirección viene de la imagen de un diseño ya hecho y todavía no tiene prototipo/,
    );
    expect(call3.notes![0]).toContain('Conviértelo en un prototipo interactivo');
    expect(view.ui.options.at(-1)).toMatchObject({ id: 'ui-3', title: 'Panel ajustado', source: 'GENERATED' });
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-3')).toContain('Panel ajustado');
  });

  it('React code is converted by the engine into a self-contained HTML prototype and added as an imported direction', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:import_design', projectId, { name: 'App.jsx', kind: 'REACT', content: REACT_SOURCE });
    const view = await settled();
    expect(view).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', error: null });
    expect(view.ui.options.at(-1)).toMatchObject({ id: 'ui-3', title: 'Panel ajustado', source: 'IMPORTED' });
    const conversion = engine.explored.at(-1)!;
    expect(conversion.option).toMatchObject({ title: 'App', prototypeHtml: REACT_SOURCE });
    expect(conversion.notes![0]).toMatch(/NO es HTML: es el código de un componente React/);
    expect(conversion.notes![0]).toMatch(/sin React ni ninguna dependencia/);
    // The result is a normal prototype, served as such.
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-3')).toContain('<!doctype html>');
  });

  it('refuses what is not an image or React code, before running any model', async () => {
    const { engine, translator, projectId, call, toExploring } = await setup();
    await toExploring();
    const before = engine.explored.length;
    await expect(
      call('inception:import_design', projectId, {
        name: 'a.pdf',
        kind: 'IMAGE',
        content: Buffer.from('%PDF-1.4 x').toString('base64'),
      }),
    ).rejects.toThrow(/importa una imagen \(png, jpg, jpeg, webp, gif\)/);
    await expect(
      call('inception:import_design', projectId, {
        name: 'a.png',
        kind: 'IMAGE',
        content: Buffer.from('esto no es un png').toString('base64'),
      }),
    ).rejects.toThrow('no es un archivo .png válido');
    await expect(
      call('inception:import_design', projectId, { name: 'a.exe', kind: 'IMAGE', content: PNG_B64 }),
    ).rejects.toThrow('tipo de archivo no admitido');
    await expect(
      call('inception:import_design', projectId, { name: 'App.jsx', kind: 'REACT', content: '   ' }),
    ).rejects.toThrow('El código está vacío');
    await expect(
      call('inception:import_design', projectId, {
        name: 'App.jsx',
        kind: 'REACT',
        content: '<!doctype html><html><body>hola</body></html>',
      }),
    ).rejects.toThrow('impórtalo como HTML');
    await expect(
      call('inception:import_design', projectId, {
        name: 'App.jsx',
        kind: 'REACT',
        content: 'solo texto, sin código ni etiquetas',
      }),
    ).rejects.toThrow('no parece código React');
    await expect(
      call('inception:import_design', projectId, {
        name: 'App.jsx',
        kind: 'REACT',
        content: `export default function A(){return <p>${'x'.repeat(MAX_PROTOTYPE_CHARS)}</p>}`,
      }),
    ).rejects.toThrow('supera');
    await expect(call('inception:import_design', projectId, { name: 'a', kind: 'OTRO', content: 'x' })).rejects.toThrow(
      'Importa una imagen o código React',
    );
    expect(translator.calls).toHaveLength(0);
    expect(engine.explored).toHaveLength(before);
  });

  it('counts towards the limit of five directions and only works while choosing', async () => {
    const { projectId, call, settled, toExploring } = await setup();
    await expect(
      call('inception:import_design', projectId, { name: 'a.png', kind: 'IMAGE', content: PNG_B64 }),
    ).rejects.toThrow('No estás eligiendo una dirección visual');
    await toExploring();
    for (const index of [3, 4, 5]) {
      await call('inception:import_design', projectId, { name: `d${index}.png`, kind: 'IMAGE', content: PNG_B64 });
      await settled();
    }
    await expect(
      call('inception:import_design', projectId, { name: 'd6.png', kind: 'IMAGE', content: PNG_B64 }),
    ).rejects.toThrow('como mucho 5 direcciones');
    expect((await call<InceptionViewDto>('inception:get', projectId)).ui.options.map(option => option.id)).toEqual([
      'ui-1',
      'ui-2',
      'ui-3',
      'ui-4',
      'ui-5',
    ]);
  });
});

describe('going back to the design from the proposal', () => {
  it('returns to the directions already generated, with the choice kept and the pending proposal rejected', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, 'ui-2');
    const proposed = await settled();
    const changeSetId = proposed.proposal!.changeSetId;
    const back = await call<InceptionViewDto>('inception:reopen_design', projectId);
    expect(back).toMatchObject({
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      nextAction: 'CHOOSE_UI',
      error: null,
      proposal: null,
      ui: { selectedOptionId: 'ui-2' },
    });
    expect(back.ui.options.map(option => option.title)).toEqual(['Panel claro', 'Lista minimalista']);
    expect(engine.explored).toHaveLength(1); // nothing was generated again
    const changeSets = await call<Array<{ id: string; status: string }>>('changeset:list', projectId);
    expect(changeSets.find(item => item.id === changeSetId)?.status).toBe('REJECTED');
    // Choosing another direction prepares a new proposal built on it.
    await call('inception:choose_ui', projectId, 'ui-1');
    expect(await settled()).toMatchObject({ stage: 'PROPOSAL', ui: { selectedOptionId: 'ui-1' } });
    expect(engine.proposed.at(-1)!.direction).toMatchObject({ title: 'Panel claro' });
  });

  it('when the design was never asked for it generates the directions now from the same answers, and a failure offers the retry', async () => {
    const { engine, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Un panel' });
    await settled();
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }]);
    const proposed = await settled();
    expect(proposed).toMatchObject({ stage: 'PROPOSAL', ui: { wanted: false, options: [] } });
    engine.failExplore = true;
    const working = await call<InceptionViewDto>('inception:reopen_design', projectId);
    expect(working).toMatchObject({ stage: 'ASK_GOALS', status: 'WORKING', proposal: null, ui: { wanted: true } });
    expect(await settled()).toMatchObject({
      stage: 'ASK_GOALS',
      status: 'FAILED',
      nextAction: 'RETRY_UI',
      error: 'motor de diseño caído',
    });
    engine.failExplore = false;
    await call('inception:answer', projectId, proposed.answers, undefined, { exploreUi: true });
    const view = await settled();
    expect(view).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', ui: { wanted: true } });
    expect(view.ui.options).toHaveLength(2);
    expect(engine.explored.at(-1)!.project.brief).toBe('Un panel');
  });

  it('is refused anywhere but while reviewing the proposal', async () => {
    const { projectId, call, settled, toExploring } = await setup();
    await expect(call('inception:reopen_design', projectId)).rejects.toThrow('mientras revisas la propuesta');
    await toExploring();
    expect((await call<InceptionViewDto>('inception:get', projectId)).stage).toBe('EXPLORE_UI');
  });
});

describe('a call interrupted by closing the app can be retried (it used to be refused)', () => {
  it('first gate: the view says failed and the retry is accepted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-interrupted-'));
    roots.push(root);
    const first = new FakeEngine();
    first.hang = true;
    const one = await setup(root, first);
    // askGoals of the fake never hangs; interrupt the design call instead, from the questions on.
    await one.call('inception:start', one.projectId, { brief: 'Un panel' });
    await one.settled();
    await one.call('inception:answer', one.projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, {
      exploreUi: true,
    });
    one.core.close();
    cores.splice(cores.indexOf(one.core), 1);
    const reopened = await setup(root, new FakeEngine(), one.projectId);
    const view = await reopened.call<InceptionViewDto>('inception:get', reopened.projectId);
    expect(view).toMatchObject({
      stage: 'ASK_GOALS',
      status: 'FAILED',
      nextAction: 'RETRY_UI',
      error: 'La llamada se interrumpió (la app se cerró). Vuelve a intentarlo.',
    });
    await reopened.call('inception:answer', reopened.projectId, view.answers, undefined, { exploreUi: true });
    expect(await reopened.settled()).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', error: null });
  });

  it('while adjusting a prototype: back to choosing, with the reason', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-interrupted-'));
    roots.push(root);
    const engine = new FakeEngine();
    const one = await setup(root, engine);
    await one.toExploring();
    engine.hang = true;
    await one.call('inception:revise_ui', one.projectId, 'ui-1', 'Más grande');
    one.core.close();
    cores.splice(cores.indexOf(one.core), 1);
    const reopened = await setup(root, new FakeEngine(), one.projectId);
    const view = await reopened.call<InceptionViewDto>('inception:get', reopened.projectId);
    expect(view).toMatchObject({
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      nextAction: 'CHOOSE_UI',
      error: expect.stringContaining('interrumpió'),
    });
    expect(view.ui.options).toHaveLength(2);
    await reopened.call('inception:choose_ui', reopened.projectId, 'ui-1');
    expect((await reopened.settled()).stage).toBe('PROPOSAL');
  });
});
