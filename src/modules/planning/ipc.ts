import {
  MAX_REFERENCES,
  MAX_REFERENCE_NOTE,
  REFERENCE_KINDS,
  type ReferenceKind,
} from '../../shared/contracts/inception-view.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { ChangeOperation } from '../knowledge/index.js';
import { normalizeTranslation } from '../inception/index.js';
import type { ChangeSetPlanningService } from './application/change-set-planning-service.js';
import type { PlanningReferencesService } from './application/planning-references.js';
import type { PlanningReference } from './application/ports/change-set-planning-port.js';

export interface PlanningIpcDeps {
  planning(projectId: string): ChangeSetPlanningService;
  planningForChangeSet(changeSetId: string): ChangeSetPlanningService;
  planningReferences: Pick<PlanningReferencesService, 'translate'>;
  emit(channel: string, payload: unknown): void;
}

/** Proposals of changes to the plan (ChangeSets): edit, apply, reject, list, and translating references for one. */
export function planningHandlers(d: PlanningIpcDeps): IpcHandlers {
  return {
    'planning:translate_references': ([projectId, references]) =>
      d.planningReferences.translate(text(projectId), references),
    'changeset:edit': serial(([id, operations]) =>
      d.planningForChangeSet(text(id)).edit(text(id), operations as ChangeOperation[]),
    ),
    'changeset:apply': serial(async ([id]) => {
      const result = await d.planningForChangeSet(text(id)).apply(text(id));
      d.emit('graph:revision_updated', { projectId: result.changeSet.projectId, revision: result.revision });
      return result;
    }),
    'changeset:reject': serial(([id]) => d.planningForChangeSet(text(id)).reject(text(id))),
    'changeset:list': ([projectId]) => d.planning(text(projectId)).list(text(projectId)),
  };
}

/** References the renderer sends back with a proposal (already translated): checked and capped again here, field by field and per kind. */
export function planningReferenceInputs(value: unknown): PlanningReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Las referencias deben enviarse como una lista.');
  if (value.length > MAX_REFERENCES) throw new Error(`Puedes usar como mucho ${MAX_REFERENCES} referencias.`);
  return value.flatMap(raw => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const kind = item.kind as ReferenceKind;
    if (!REFERENCE_KINDS.includes(kind))
      throw new Error('Indica si cada referencia es visual, funcional o conceptual.');
    const name =
      String(item.name ?? '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()!
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 120) || 'referencia';
    const note = String(item.note ?? '')
      .trim()
      .slice(0, MAX_REFERENCE_NOTE);
    if (!item.translation || typeof item.translation !== 'object') return [];
    return [{ kind, name, note, translation: normalizeTranslation(kind, item.translation) }];
  });
}
