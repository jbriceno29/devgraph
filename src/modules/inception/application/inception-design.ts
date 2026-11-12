import { type InceptionViewDto, MAX_INCEPTION_NOTE } from '../../../shared/contracts/inception-view.js';
import { get } from './inception-flow.js';
import {
  IMAGE_TO_PROTOTYPE_NOTE,
  type InceptionKernel,
  imagePage,
  projectInput,
  findRecord,
  requireExploring,
  requireProject,
  toUiOption,
  uiModel,
} from './inception-kernel.js';
import { exploreWork, launch, proposalWork } from './inception-work.js';
import type { InceptionRecord } from './ports/inception-port.js';

/** Regenerates one direction with the user's change requests; the others stay. A failure leaves everything as it was, with the reason. */
export function reviseUiOption(
  k: InceptionKernel,
  projectId: string,
  optionId: string,
  notes: string,
): InceptionViewDto {
  const current = requireExploring(k, projectId),
    project = requireProject(k, projectId);
  const option = current.ui.options.find(item => item.id === optionId);
  if (!option) throw new Error('Esa dirección visual ya no existe.');
  const note = String(notes ?? '').trim();
  if (!note) throw new Error('Cuéntale al asistente qué quieres cambiar de este prototipo.');
  if (note.length > MAX_INCEPTION_NOTE)
    throw new Error(`Lo que quieres cambiar admite como mucho ${MAX_INCEPTION_NOTE} caracteres.`);
  const record: InceptionRecord = { ...current, status: 'WORKING', error: null, updatedAt: new Date().toISOString() };
  k.deps.store.save(record);
  launch(
    k,
    record,
    async signal => {
      const { prototypeHtml, title, summary, navigation, screens, designSystemNotes } = option;
      // A direction that comes from a picture has no HTML: adjusting it asks the engine to build the prototype from its description.
      const notes = option.source === 'IMAGE' ? [`${IMAGE_TO_PROTOTYPE_NOTE} ${note}`] : [note];
      const result = await k.deps.engine.exploreUi({
        project: projectInput(
          k,
          projectId,
          record.brief,
          project.props,
          record.references ?? [],
          undefined,
          record.repository,
        ),
        questions: record.questions,
        answers: record.answers,
        ...uiModel(k, record),
        revise: { option: { title, summary, navigation, screens, designSystemNotes, prototypeHtml }, notes },
        signal,
      });
      const draft = result.options[0];
      if (!draft) throw new Error('El asistente no devolvió el prototipo ajustado.');
      return {
        stage: 'EXPLORE_UI',
        status: 'WAITING_USER',
        ui: {
          ...record.ui,
          options: record.ui.options.map(item =>
            item.id === optionId
              ? toUiOption(k, draft, item.source === 'IMAGE' ? 'GENERATED' : item.source, item.id)
              : item,
          ),
        },
        usage: result.usage,
      };
    },
    'EXPLORE_UI',
    'WAITING_USER',
  );
  return get(k, projectId);
}

/** Approves a direction and asks for the proposal built on it; `null` skips the design and goes straight to the plan. */
export function chooseUiOption(k: InceptionKernel, projectId: string, optionId: string | null): InceptionViewDto {
  const current = requireExploring(k, projectId),
    project = requireProject(k, projectId);
  if (optionId !== null && !current.ui.options.some(item => item.id === optionId))
    throw new Error('Esa dirección visual ya no existe.');
  // While the proposal is prepared the inception is in the proposal gate; if that fails it comes back to choosing, with the reason and the selection kept.
  const record: InceptionRecord = {
    ...current,
    stage: 'PROPOSAL',
    status: 'WORKING',
    error: null,
    changeSetId: null,
    ui: { ...current.ui, selectedOptionId: optionId },
    updatedAt: new Date().toISOString(),
  };
  k.deps.store.save(record);
  launch(k, record, signal => proposalWork(k, record, project.props, signal), 'EXPLORE_UI', 'WAITING_USER');
  return get(k, projectId);
}

/**
 * Back from the proposal to the design step: the directions already generated (with the choice kept), or — when the design was never asked for —
 * generated now from the same answers. The pending proposal is rejected; a new one is prepared when a direction is approved or the design skipped.
 */
export function reopenDesign(k: InceptionKernel, projectId: string): InceptionViewDto {
  const current = findRecord(k, projectId),
    project = requireProject(k, projectId);
  if (!current || current.stage !== 'PROPOSAL' || current.status !== 'WAITING_USER')
    throw new Error('Solo puedes volver al diseño mientras revisas la propuesta.');
  if (current.changeSetId) {
    const pending = k.deps.planning.find(current.changeSetId);
    if (pending && !['APPLIED', 'REJECTED'].includes(pending.status)) k.deps.planning.reject(pending.id);
  }
  const now = new Date().toISOString();
  if (current.ui.options.length) {
    k.deps.store.save({
      ...current,
      stage: 'EXPLORE_UI',
      status: 'WAITING_USER',
      changeSetId: null,
      error: null,
      ui: { ...current.ui, wanted: true },
      updatedAt: now,
    });
    return get(k, projectId);
  }
  // Never explored: it behaves like asking for it with the questions (the first gate again), so a failure offers «Reintentar las direcciones visuales».
  const record: InceptionRecord = {
    ...current,
    stage: 'ASK_GOALS',
    status: 'WORKING',
    changeSetId: null,
    error: null,
    ui: { ...current.ui, wanted: true, options: [], selectedOptionId: null },
    updatedAt: now,
  };
  k.deps.store.save(record);
  launch(k, record, signal => exploreWork(k, record, project.props, signal), 'ASK_GOALS');
  return get(k, projectId);
}

/** The HTML of a direction's prototype (the view does not carry it: it is polled while the engine works). */
export function getUiPrototype(k: InceptionKernel, projectId: string, optionId: string): string {
  requireProject(k, projectId);
  const option = findRecord(k, projectId)?.ui.options.find(item => item.id === optionId);
  if (!option) throw new Error('Esa dirección visual ya no existe.');
  if (option.imageFile) {
    if (!k.deps.referenceFiles) throw new Error('No se puede leer la imagen de esta dirección.');
    return imagePage(option.imageMime ?? 'image/png', k.deps.referenceFiles.read(projectId, option.imageFile));
  }
  return option.prototypeHtml;
}
