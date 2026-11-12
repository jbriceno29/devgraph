import { renderContextSnapshot } from '../../modules/context/application/context-packager.js';
import { planningReferenceInputs } from '../../modules/planning/ipc.js';
import { text } from '../../shared/ipc-handlers.js';
import { UI_SPEC_PATH } from '../../shared/ui-spec.js';
import type { Container } from '../container.js';

/**
 * Planificar: a proposal of changes to the plan from what the user wrote, with the prepared context snapshot, the
 * translated references (data) and the interface specification (docs/UI_SPEC.md) when it exists.
 */
export async function proposeFromChat(c: Container, args: unknown[]) {
  const projectId = text(args[0]),
    prompt = text(args[1]),
    focusEntityId = args[2] === undefined ? undefined : String(args[2]);
  const contextPackage =
    args[3] === undefined ? undefined : snapshotPackage(c, projectId, focusEntityId, String(args[3]));
  const model = typeof args[4] === 'string' && args[4].trim() ? args[4].trim() : undefined;
  if (model && !c.connection(projectId).availableModels.includes(model))
    throw new Error(`El modelo ${model} no está disponible para planificar.`);
  const options = (args[5] && typeof args[5] === 'object' ? args[5] : {}) as {
    references?: unknown;
    updateUiSpec?: unknown;
  };
  const references = planningReferenceInputs(options.references);
  const management = c.management(projectId),
    specDocument = management.repositoryPath(projectId)
      ? management
          .list(projectId)
          .find(document => document.relativePath === UI_SPEC_PATH && document.entityType === 'ARTIFACT')
      : undefined;
  const update = options.updateUiSpec === true;
  const specContent =
    specDocument && update ? ((await management.read(specDocument.id).catch(() => null))?.content ?? null) : null;
  const uiSpec =
    specDocument || update ? { entityId: specDocument?.id ?? null, content: specContent, update } : undefined;
  return c.planning(projectId).propose(projectId, prompt, focusEntityId, contextPackage, model, {
    ...(references.length ? { references } : {}),
    ...(uiSpec ? { uiSpec } : {}),
  });
}

function snapshotPackage(c: Container, projectId: string, focusEntityId: string | undefined, snapshotId: string) {
  const snapshot = c.context(projectId).getSnapshot(snapshotId);
  if (snapshot.projectId !== projectId || snapshot.focusEntityId !== focusEntityId)
    throw new Error('El ContextSnapshot no corresponde al proyecto y foco seleccionados.');
  if (snapshot.graphRevision !== c.currentRevision(projectId))
    throw new Error(
      'El ContextSnapshot quedó desactualizado; vuelve a preparar el contexto antes de proponer cambios.',
    );
  return renderContextSnapshot(snapshot);
}
