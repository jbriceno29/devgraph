import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type {
  InceptionEnginePort,
  InceptionProjectInput,
  ReferenceTranslatorPort,
} from '../../src/modules/inception/application/ports/inception-port.js';
import type { InceptionReferenceInput, InceptionViewDto } from '../../src/shared/contracts/inception-view.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const usage = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.001,
  model: 'fake',
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const reference = (over: Partial<InceptionReferenceInput> = {}): InceptionReferenceInput => ({
  name: 'panel.png',
  kind: 'VISUAL',
  note: 'sin sombras',
  dataBase64: PNG.toString('base64'),
  ...over,
});
const translation = (summary: string) => ({
  summary,
  palette: ['azul'],
  typography: '',
  layout: 'Dos columnas',
  screens: [],
  actions: [],
  flows: [],
  states: [],
  ideas: [],
  openQuestions: [],
});

/** Records what the assistant receives (it must be text only) and stops the proposal right there. */
class RecordingEngine implements InceptionEnginePort {
  asked: InceptionProjectInput[] = [];
  proposed: InceptionProjectInput[] = [];
  failAsk = false;
  async askGoals(input: Parameters<InceptionEnginePort['askGoals']>[0]) {
    this.asked.push(input.project);
    if (this.failAsk) throw new Error('motor caído');
    return {
      questions: [{ id: 'q1', text: '¿Quién la usa?', options: ['Solo yo'], default: 'Solo yo', why: 'Alcance.' }],
      assumptions: [],
      usage,
    };
  }
  async propose(input: Parameters<InceptionEnginePort['propose']>[0]): Promise<never> {
    this.proposed.push(input.project);
    throw new Error('captured');
  }
  async exploreUi(): Promise<never> {
    throw new Error('not used here');
  }
}

/** Reads the stored copies like the real translator would and answers per id; `fail` makes one reference unreadable. */
class FakeTranslator implements ReferenceTranslatorPort {
  calls: Array<Array<{ id: string; kind: string; note: string; mimeType: string; copy: Buffer | null; path: string }>> =
    [];
  models: Array<string | undefined> = [];
  fail = new Set<string>();
  down = false;
  async translate(input: Parameters<ReferenceTranslatorPort['translate']>[0]) {
    this.calls.push(
      input.files.map(file => ({ ...file, copy: existsSync(file.path) ? readFileSync(file.path) : null })),
    );
    this.models.push(input.model);
    if (this.down) throw new Error('traductor caído');
    return {
      results: input.files.map(file =>
        this.fail.has(file.id)
          ? { id: file.id, translation: null, error: 'El archivo no se pudo leer.' }
          : { id: file.id, translation: translation(`Descripción de ${file.id}`), error: null },
      ),
      usage,
    };
  }
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'graphdev2-refs-'));
  roots.push(root);
  const engine = new RecordingEngine(),
    translator = new FakeTranslator();
  const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, {
    inceptionEngine: engine,
    referenceTranslator: translator,
  });
  cores.push(core);
  const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Tareas', slug: 'tareas' }] })) as {
    id: string;
  };
  await core.handle({ channel: 'project:open', args: [project.id] });
  const call = async <T>(channel: string, ...args: unknown[]) =>
    (await core.handle({ channel: channel as never, args })) as T;
  const settled = async () => {
    await core.inceptionSettled(project.id);
    return call<InceptionViewDto>('inception:get', project.id);
  };
  const folder = join(root, 'workspace', 'projects', project.id, 'inception', 'references');
  return { engine, translator, projectId: project.id, call, settled, folder };
}

describe('inception with attached references', () => {
  it('stores the files, translates them in one call and gives the assistant text only', async () => {
    const { engine, translator, projectId, call, settled, folder } = await setup();
    const started = await call<InceptionViewDto>('inception:start', projectId, {
      brief: 'Una lista de tareas',
      references: [
        reference(),
        reference({
          name: 'flujo.md',
          kind: 'FUNCTIONAL',
          note: '',
          dataBase64: Buffer.from('# Flujo\n').toString('base64'),
        }),
      ],
    });
    expect(started.status).toBe('WORKING');
    expect(started.references.map(item => [item.id, item.name, item.kind, item.status])).toEqual([
      ['ref-1', 'panel.png', 'VISUAL', 'PENDING'],
      ['ref-2', 'flujo.md', 'FUNCTIONAL', 'PENDING'],
    ]);
    const view = await settled();
    expect(view).toMatchObject({ stage: 'ASK_GOALS', status: 'WAITING_USER', error: null });
    expect(view.references.map(item => [item.status, item.translation?.summary])).toEqual([
      ['TRANSLATED', 'Descripción de ref-1'],
      ['TRANSLATED', 'Descripción de ref-2'],
    ]);
    // The files are stored under fixed names, and the view never exposes paths or content.
    expect(readdirSync(folder).sort()).toEqual(['ref-1.png', 'ref-2.md']);
    expect(JSON.stringify(view)).not.toContain(folder);
    expect(JSON.stringify(view)).not.toContain(PNG.toString('base64'));
    // One translator call for both files, from the stored copies, with a cheap vision model rather than the planning one.
    expect(translator.calls).toHaveLength(1);
    expect(
      translator.calls[0]!.map(file => [
        file.id,
        file.kind,
        file.mimeType,
        file.mimeType === 'image/png' ? file.copy?.equals(PNG) : file.copy?.toString(),
      ]),
    ).toEqual([
      ['ref-1', 'VISUAL', 'image/png', true],
      ['ref-2', 'FUNCTIONAL', 'text/markdown', '# Flujo\n'],
    ]);
    expect(translator.models[0]).toMatch(/sonnet|haiku/);
    // The assistant gets the translation as data, not the files.
    expect(engine.asked).toHaveLength(1);
    expect(engine.asked[0]!.references).toEqual([
      { kind: 'VISUAL', name: 'panel.png', note: 'sin sombras', translation: translation('Descripción de ref-1') },
      { kind: 'FUNCTIONAL', name: 'flujo.md', note: '', translation: translation('Descripción de ref-2') },
    ]);
    expect(JSON.stringify(engine.asked[0])).not.toContain(PNG.toString('base64'));
    expect(view.usage.calls).toBe(2);
  });

  it('the proposal gate receives the stored translation too, without translating again', async () => {
    const { engine, translator, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Una lista', references: [reference()] });
    await settled();
    await call('inception:answer', projectId, [{ questionId: 'q1', answer: 'Solo yo' }]);
    await settled();
    expect(engine.proposed).toHaveLength(1);
    expect(engine.proposed[0]!.references?.[0]).toMatchObject({
      kind: 'VISUAL',
      name: 'panel.png',
      translation: { summary: 'Descripción de ref-1' },
    });
    expect(translator.calls).toHaveLength(1);
  });

  it('a reference the translator cannot read fails the step with its name; the retry reuses what was understood and the stored files', async () => {
    const { engine, translator, projectId, call, settled, folder } = await setup();
    translator.fail.add('ref-2');
    await call('inception:start', projectId, {
      brief: 'Una lista',
      references: [reference(), reference({ name: 'roto.png' })],
    });
    const failed = await settled();
    expect(failed).toMatchObject({ stage: 'ASK_GOALS', status: 'FAILED', nextAction: 'RETRY_QUESTIONS' });
    expect(failed.error).toContain('«roto.png»');
    expect(failed.error).toContain('El archivo no se pudo leer.');
    expect(failed.references.map(item => item.status)).toEqual(['TRANSLATED', 'FAILED']);
    expect(engine.asked).toHaveLength(0);
    // The retry (the UI sends the brief only) translates just the failed one, from the stored file.
    translator.fail.clear();
    await call('inception:start', projectId, { brief: 'Una lista' });
    const ok = await settled();
    expect(ok).toMatchObject({ status: 'WAITING_USER', error: null });
    expect(translator.calls).toHaveLength(2);
    expect(translator.calls[1]!.map(file => file.id)).toEqual(['ref-2']);
    expect(ok.references.map(item => item.status)).toEqual(['TRANSLATED', 'TRANSLATED']);
    expect(engine.asked[0]!.references).toHaveLength(2);
    expect(readdirSync(folder).sort()).toEqual(['ref-1.png', 'ref-2.png']);
  });

  it('keeps what the translator understood when the assistant fails afterwards, and does not translate again on retry', async () => {
    const { engine, translator, projectId, call, settled } = await setup();
    engine.failAsk = true;
    await call('inception:start', projectId, { brief: 'Una lista', references: [reference()] });
    const failed = await settled();
    expect(failed).toMatchObject({ status: 'FAILED', error: 'motor caído' });
    expect(failed.references[0]).toMatchObject({
      status: 'TRANSLATED',
      translation: { summary: 'Descripción de ref-1' },
    });
    engine.failAsk = false;
    await call('inception:start', projectId, { brief: 'Una lista' });
    expect((await settled()).status).toBe('WAITING_USER');
    expect(translator.calls).toHaveLength(1);
    expect(engine.asked[1]!.references).toHaveLength(1);
  });

  it('a translator that is down fails the step and keeps the files for the retry', async () => {
    const { translator, projectId, call, settled, folder } = await setup();
    translator.down = true;
    await call('inception:start', projectId, { brief: 'Una lista', references: [reference()] });
    expect(await settled()).toMatchObject({ status: 'FAILED', error: 'traductor caído' });
    expect(existsSync(join(folder, 'ref-1.png'))).toBe(true);
  });

  it('refuses invalid references before writing or running anything', async () => {
    const { engine, translator, projectId, call, folder } = await setup();
    await expect(
      call('inception:start', projectId, { brief: 'x', references: [reference({ name: 'virus.exe' })] }),
    ).rejects.toThrow('tipo de archivo no admitido');
    await expect(
      call('inception:start', projectId, {
        brief: 'x',
        references: [reference({ dataBase64: Buffer.from('no soy un png').toString('base64') })],
      }),
    ).rejects.toThrow('no es un archivo .png válido');
    expect(existsSync(folder)).toBe(false);
    expect(translator.calls).toHaveLength(0);
    expect(engine.asked).toHaveLength(0);
    expect((await call<InceptionViewDto>('inception:get', projectId)).stage).toBe('NOT_STARTED');
  });

  it('restart removes the stored files and forgets the references', async () => {
    const { projectId, call, settled, folder } = await setup();
    await call('inception:start', projectId, { brief: 'Una lista', references: [reference()] });
    await settled();
    expect(existsSync(folder)).toBe(true);
    const restarted = await call<InceptionViewDto>('inception:restart', projectId);
    expect(restarted).toMatchObject({ stage: 'NOT_STARTED', references: [] });
    expect(existsSync(folder)).toBe(false);
  });

  it('without references nothing changes: no translator call and no references in the prompts', async () => {
    const { engine, translator, projectId, call, settled } = await setup();
    await call('inception:start', projectId, { brief: 'Una lista' });
    const view = await settled();
    expect(view).toMatchObject({ status: 'WAITING_USER', references: [] });
    expect(translator.calls).toHaveLength(0);
    expect(engine.asked[0]).not.toHaveProperty('references');
  });
});
