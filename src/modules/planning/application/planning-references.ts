import type { InceptionReferenceFilesPort, ReferenceTranslatorPort } from '../../inception/index.js';
import { prepareReferences } from '../../inception/index.js';
import type { InceptionReferenceDto } from '../../../shared/contracts/inception-view.js';

/**
 * References attached while planning a feature on a project in progress (Planificar). The same translator as the inception (V1) turns each file into
 * text; the planner only receives that text. The files are checked like the inception's, stored only for the duration of the call (in the project's
 * workspace folder, under names fixed by the app) and removed afterwards; what was understood is returned for the user to check before proposing.
 */
export class PlanningReferencesService {
  private readonly running = new Set<string>();
  constructor(
    private readonly deps: {
      /** The translator wired for the project (it follows the project's engine and auth). */ translator?: (
        projectId: string,
      ) => ReferenceTranslatorPort;
      files?: InceptionReferenceFilesPort;
      models(projectId: string): { planning: string | null; available: string[] };
      projectExists(projectId: string): boolean;
    },
  ) {}

  async translate(projectId: string, inputs: unknown, signal?: AbortSignal): Promise<InceptionReferenceDto[]> {
    if (!this.deps.projectExists(projectId)) throw new Error('Proyecto no encontrado.');
    const { translator, files } = this.deps;
    if (!translator || !files) throw new Error('Esta versión de la app no puede analizar referencias.');
    const prepared = prepareReferences(inputs);
    if (!prepared.length) throw new Error('Adjunta al menos una referencia.');
    if (this.running.has(projectId))
      throw new Error('Ya se están analizando referencias de este proyecto; espera a que termine.');
    this.running.add(projectId);
    try {
      files.deleteAll(projectId);
      for (const item of prepared) files.save(projectId, item.file, item.content);
      const models = this.deps.models(projectId),
        model = ['sonnet', 'haiku'].find(alias => models.available.includes(alias)) ?? models.planning;
      const out = await translator(projectId).translate({
        files: prepared.map(item => ({
          id: item.id,
          kind: item.kind,
          note: item.note,
          mimeType: item.mimeType,
          path: files.pathOf(projectId, item.file),
        })),
        ...(model ? { model } : {}),
        ...(signal ? { signal } : {}),
      });
      const byId = new Map(out.results.map(result => [result.id, result]));
      return prepared.map(({ content: _content, file: _file, ...item }): InceptionReferenceDto => {
        const result = byId.get(item.id);
        return result?.translation
          ? { ...item, status: 'TRANSLATED', error: null, translation: result.translation }
          : {
              ...item,
              status: 'FAILED',
              error: result?.error ?? 'El traductor no devolvió esta referencia.',
              translation: null,
            };
      });
    } finally {
      files.deleteAll(projectId);
      this.running.delete(projectId);
    }
  }
}
