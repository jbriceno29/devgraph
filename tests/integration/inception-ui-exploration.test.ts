import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '@infrastructure/ipc/sidecar/workspace-core.js';
import type { InceptionEnginePort, InceptionProjectInput, UiOptionDraft } from '../../src/application/ports/inception-port.js';
import type { ActivitySummaryDto } from '../../src/shared/contracts/activity-view.js';
import { MAX_PROTOTYPE_CHARS, type InceptionViewDto } from '../../src/shared/contracts/inception-view.js';
import { proposal, usage } from './inception-fixtures.js';

const roots: string[] = []; const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => { for (const core of cores.splice(0)) core.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const page = (title: string, extra = '') => `<!doctype html><html><head><title>${title}</title><style>body{font-family:sans-serif}</style></head><body><h1>${title}</h1><main><ul><li>Tarea uno</li></ul></main><script>document.title='${title}';</script>${extra}</body></html>`;
const draft = (title: string, html = page(title)): UiOptionDraft => ({ title, summary: `${title}: resumen.`, navigation: 'Barra lateral.', screens: ['Inicio', 'Tareas'], designSystemNotes: ['Azul #2255ff'], prototypeHtml: html });

class FakeEngine implements InceptionEnginePort {
  explored: Array<{ models: string | undefined; revise: boolean; project: InceptionProjectInput; notes?: string[] }> = []; proposed: InceptionProjectInput[] = [];
  failExplore = false; failPropose = false; hang = false; reviseTitle = 'Panel ajustado';
  async askGoals() { return { questions: [{ id: 'q1', text: '¿Quién la usa?', options: ['Solo yo'], default: 'Solo yo', why: 'Alcance.' }], assumptions: [], usage }; }
  async exploreUi(input: Parameters<InceptionEnginePort['exploreUi']>[0]) {
    this.explored.push({ models: input.model, revise: Boolean(input.revise), project: input.project, ...(input.revise ? { notes: input.revise.notes } : {}) });
    if (this.hang) await new Promise((_resolve, reject) => input.signal?.addEventListener('abort', () => reject(new Error('cancelada')), { once: true }));
    if (this.failExplore) throw new Error('motor de diseño caído');
    if (input.revise) return { options: [draft(this.reviseTitle, page(this.reviseTitle, `<!-- notas: ${input.revise.notes.join('|')} -->`))], assumptions: [], usage };
    return { options: [draft('Panel claro', page('Panel claro', '<link href="https://cdn.example.com/x.css">')), draft('Lista minimalista')], assumptions: ['Interfaz web'], usage };
  }
  async propose(input: Parameters<InceptionEnginePort['propose']>[0]) {
    this.proposed.push(input.project);
    if (this.failPropose) throw new Error('propuesta caída');
    return { draft: { title: 'Inicio: tareas', rationale: 'Simple.', operations: proposal().map(op => (op.type === 'CREATE_RELATIONSHIP' && op.targetId === 'ROOT' ? { ...op, targetId: input.project.rootId } : op)) }, assumptions: [], usage };
  }
}

async function setup(root = mkdtempSync(join(tmpdir(), 'graphdev2-ui-explore-')), engine = new FakeEngine(), existing?: string) {
  if (!existing) roots.push(root);
  const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, { inceptionEngine: engine }); cores.push(core);
  const projectId = existing ?? (await core.handle({ channel: 'project:create', args: [{ name: 'Tareas', slug: 'tareas' }] }) as { id: string }).id;
  await core.handle({ channel: 'project:open', args: [projectId] });
  const call = async <T,>(channel: string, ...args: unknown[]) => await core.handle({ channel: channel as never, args }) as T;
  const settled = async () => { await core.inceptionSettled(projectId); return call<InceptionViewDto>('inception:get', projectId); };
  /** Brief → questions → answers with the design step requested → directions to choose from. */
  const toExploring = async () => {
    await call('inception:start', projectId, { brief: 'Un panel de tareas' }); await settled();
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, { exploreUi: true });
    return settled();
  };
  return { root, core, engine, projectId, call, settled, toExploring };
}

describe('visual exploration before the proposal (V2)', () => {
  it('asks for directions after the answers, keeps the prototypes out of the view and serves each one apart', async () => {
    const { engine, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Un panel de tareas' }); await settled();
    const working = await call<InceptionViewDto>('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, { exploreUi: true });
    expect(working).toMatchObject({ stage: 'ASK_GOALS', status: 'WORKING', ui: { wanted: true, options: [] } });
    const view = await settled();
    expect(view).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', nextAction: 'CHOOSE_UI', error: null, ui: { wanted: true, selectedOptionId: null } });
    expect(view.ui.options.map(option => [option.id, option.title, option.source, option.screens])).toEqual([['ui-1', 'Panel claro', 'GENERATED', ['Inicio', 'Tareas']], ['ui-2', 'Lista minimalista', 'GENERATED', ['Inicio', 'Tareas']]]);
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
    const imported = await call<InceptionViewDto>('inception:import_prototype', projectId, { name: 'C:\\descargas\\mi-diseño.html', html: page('Mi diseño de Artifacts', '<script src="https://cdn.example.com/lib.js"></script>') });
    expect(imported.ui.options.at(-1)).toMatchObject({ id: 'ui-3', title: 'Mi diseño de Artifacts', source: 'IMPORTED', externalReferences: ['cdn.example.com'] });
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-3')).toContain('Mi diseño de Artifacts');
    const untitled = await call<InceptionViewDto>('inception:import_prototype', projectId, { name: 'boceto-final.html', html: '<div><p>hola</p></div>' });
    expect(untitled.ui.options.at(-1)).toMatchObject({ id: 'ui-4', title: 'boceto-final' });
    await expect(call('inception:import_prototype', projectId, { name: 'a.html', html: '   ' })).rejects.toThrow('está vacío');
    await expect(call('inception:import_prototype', projectId, { name: 'a.html', html: 'solo texto, sin etiquetas' })).rejects.toThrow('no parece un documento HTML');
    await expect(call('inception:import_prototype', projectId, { name: 'a.html', html: `<div>${'x'.repeat(MAX_PROTOTYPE_CHARS)}</div>` })).rejects.toThrow('supera');
    await call('inception:import_prototype', projectId, { name: 'quinta.html', html: '<main>5</main>' });
    await expect(call('inception:import_prototype', projectId, { name: 'sexta.html', html: '<main>6</main>' })).rejects.toThrow('como mucho 5 direcciones');
  });

  it('adjusts one direction with the user notes and leaves the others; a failure keeps everything and says why', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    const working = await call<InceptionViewDto>('inception:revise_ui', projectId, 'ui-1', 'Barra lateral más angosta');
    expect(working.status).toBe('WORKING');
    const revised = await settled();
    expect(revised).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', error: null });
    expect(revised.ui.options.map(option => [option.id, option.title])).toEqual([['ui-1', 'Panel ajustado'], ['ui-2', 'Lista minimalista']]);
    expect(await call<string>('inception:get_ui_prototype', projectId, 'ui-1')).toContain('notas: Barra lateral más angosta');
    expect(engine.explored.at(-1)).toMatchObject({ revise: true, notes: ['Barra lateral más angosta'] });
    // A failed adjustment leaves the options as they were, with the reason, still choosing.
    engine.failExplore = true;
    await call('inception:revise_ui', projectId, 'ui-2', 'Más colorido');
    const failed = await settled();
    expect(failed).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', nextAction: 'CHOOSE_UI', error: 'motor de diseño caído' });
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
    expect(generated.engine.proposed[0]!.direction).toEqual({ title: 'Panel claro', summary: 'Panel claro: resumen.', navigation: 'Barra lateral.', screens: ['Inicio', 'Tareas'], designSystemNotes: ['Azul #2255ff'], source: 'GENERATED' });

    const imported = await setup();
    await imported.toExploring();
    await imported.call('inception:import_prototype', imported.projectId, { name: 'mio.html', html: page('Mío') });
    await imported.call('inception:choose_ui', imported.projectId, 'ui-3');
    await imported.settled();
    expect(imported.engine.proposed[0]!.direction).toMatchObject({ title: 'Mío', source: 'IMPORTED', prototypeHtml: page('Mío') });
  });

  it('skipping the design goes straight to the plan, with no direction', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, null);
    const view = await settled();
    expect(view).toMatchObject({ stage: 'PROPOSAL', status: 'WAITING_USER', ui: { wanted: true, selectedOptionId: null } });
    expect(engine.proposed[0]).not.toHaveProperty('direction');
    // Changing the answers later regenerates the proposal and keeps the chosen direction.
  });

  it('regenerating the proposal after choosing keeps the approved direction', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    await call('inception:choose_ui', projectId, 'ui-2'); await settled();
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Un equipo' }], 'Usa Python'); await settled();
    expect(engine.proposed).toHaveLength(2);
    expect(engine.proposed[1]!.direction).toMatchObject({ title: 'Lista minimalista', source: 'GENERATED' });
  });

  it('a proposal that fails after choosing brings the user back to the directions, with the reason and the selection kept', async () => {
    const { engine, projectId, call, settled, toExploring } = await setup();
    await toExploring();
    engine.failPropose = true;
    await call('inception:choose_ui', projectId, 'ui-1');
    const failed = await settled();
    expect(failed).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', nextAction: 'CHOOSE_UI', error: 'propuesta caída', ui: { selectedOptionId: 'ui-1' } });
    expect(failed.ui.options).toHaveLength(2);
    engine.failPropose = false;
    await call('inception:choose_ui', projectId, 'ui-1');
    expect(await settled()).toMatchObject({ stage: 'PROPOSAL', status: 'WAITING_USER', error: null });
  });

  it('a failed generation can be retried with the same request, and nothing else is offered', async () => {
    const { engine, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Un panel' }); await settled();
    engine.failExplore = true;
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, { exploreUi: true });
    const failed = await settled();
    expect(failed).toMatchObject({ stage: 'ASK_GOALS', status: 'FAILED', nextAction: 'RETRY_UI', error: 'motor de diseño caído', ui: { wanted: true, options: [] } });
    engine.failExplore = false;
    // What the retry button sends; a plain retry without the option keeps the request too.
    await call('inception:answer', projectId, failed.answers, undefined, { exploreUi: true });
    expect(await settled()).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER' });
  });

  it('refuses actions out of turn', async () => {
    const { projectId, call, settled, toExploring } = await setup();
    await expect(call('inception:choose_ui', projectId, null)).rejects.toThrow('Empieza')
      .catch(async () => expect(call('inception:choose_ui', projectId, null)).rejects.toThrow());
    await call('inception:start', projectId, { brief: 'Un panel' }); await settled();
    await expect(call('inception:choose_ui', projectId, null)).rejects.toThrow('No estás eligiendo una dirección visual');
    await expect(call('inception:import_prototype', projectId, { name: 'a.html', html: '<div>x</div>' })).rejects.toThrow('No estás eligiendo');
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, { exploreUi: true }); await settled();
    await expect(call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }])).rejects.toThrow('Elige una dirección visual');
    await expect(call('inception:choose_ui', projectId, 'ui-9')).rejects.toThrow('ya no existe');
    void toExploring;
  });

  it('shows up in the activity inbox as something the user must decide', async () => {
    const { projectId, call, toExploring } = await setup();
    await toExploring();
    const activity = await call<ActivitySummaryDto>('activity:list', projectId);
    expect(activity.inception).toMatchObject({ stage: 'EXPLORE_UI', needsAttention: true, title: 'Inicio del proyecto: elige una dirección visual' });
  });

  it('restart forgets the directions', async () => {
    const { projectId, call, toExploring } = await setup();
    await toExploring();
    expect(await call<InceptionViewDto>('inception:restart', projectId)).toMatchObject({ stage: 'NOT_STARTED', ui: { wanted: false, options: [], selectedOptionId: null } });
  });
});

describe('a call interrupted by closing the app can be retried (it used to be refused)', () => {
  it('first gate: the view says failed and the retry is accepted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-interrupted-')); roots.push(root);
    const first = new FakeEngine(); first.hang = true;
    const one = await setup(root, first);
    // askGoals of the fake never hangs; interrupt the design call instead, from the questions on.
    await one.call('inception:start', one.projectId, { brief: 'Un panel' }); await one.settled();
    await one.call('inception:answer', one.projectId, [{ questionId: 'q1', answer: 'Solo yo' }], undefined, { exploreUi: true });
    one.core.close(); cores.splice(cores.indexOf(one.core), 1);
    const reopened = await setup(root, new FakeEngine(), one.projectId);
    const view = await reopened.call<InceptionViewDto>('inception:get', reopened.projectId);
    expect(view).toMatchObject({ stage: 'ASK_GOALS', status: 'FAILED', nextAction: 'RETRY_UI', error: 'La llamada se interrumpió (la app se cerró). Vuelve a intentarlo.' });
    await reopened.call('inception:answer', reopened.projectId, view.answers, undefined, { exploreUi: true });
    expect(await reopened.settled()).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', error: null });
  });

  it('while adjusting a prototype: back to choosing, with the reason', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-interrupted-')); roots.push(root);
    const engine = new FakeEngine();
    const one = await setup(root, engine);
    await one.toExploring();
    engine.hang = true;
    await one.call('inception:revise_ui', one.projectId, 'ui-1', 'Más grande');
    one.core.close(); cores.splice(cores.indexOf(one.core), 1);
    const reopened = await setup(root, new FakeEngine(), one.projectId);
    const view = await reopened.call<InceptionViewDto>('inception:get', reopened.projectId);
    expect(view).toMatchObject({ stage: 'EXPLORE_UI', status: 'WAITING_USER', nextAction: 'CHOOSE_UI', error: expect.stringContaining('interrumpió') });
    expect(view.ui.options).toHaveLength(2);
    await reopened.call('inception:choose_ui', reopened.projectId, 'ui-1');
    expect((await reopened.settled()).stage).toBe('PROPOSAL');
  });
});
