import type { ChangeOperation } from '../../domain/knowledge/change-set.js';
import { UI_SPEC_PATH, UI_SPEC_SECTIONS } from '../../shared/ui-spec.js';

type Op<T extends ChangeOperation['type']> = Extract<ChangeOperation, { type: T }>;

/** The sections of the interface specification missing from a Markdown document (level-2 headings, in any order). */
export function missingUiSpecSections(markdown: string): string[] {
  return UI_SPEC_SECTIONS.filter(section => !new RegExp(`^##\\s+${section}\\s*$`, 'mi').test(markdown));
}

/**
 * Deterministic part of «update docs/UI_SPEC.md while planning a feature», so a proposal cannot break the existing specification:
 * - with `update`, the proposal must carry the specification; when it already exists, an upsert written as a new document is turned into an update of
 *   the existing artifact (same path, never a second file), with the relationships that pointed to its tempId moved to the real id;
 * - every new feature, and every existing feature this change adds tasks to, gets DOCUMENTED_BY to the specification when there is one (existing or
 *   created here) and is not linked yet, so its agents receive it in their context (level 3), as the inception does.
 * The eight sections are checked by the ChangeSet validator, for every proposal that touches the file.
 */
export function applyUiSpecPlan(operations: ChangeOperation[], spec: { entityId: string | null; update: boolean }, graph: { /** Ids of the features that already exist. */ features?: ReadonlySet<string>; /** Features already DOCUMENTED_BY the existing specification. */ linked?: ReadonlySet<string> } = {}): { operations: ChangeOperation[]; problems: string[] } {
  const problems: string[] = [];
  let ops = operations.map(op => ({ ...op })) as ChangeOperation[];
  let upsert = ops.find((op): op is Op<'UPSERT_ARTIFACT'> => op.type === 'UPSERT_ARTIFACT' && op.relativePath === UI_SPEC_PATH);
  if (spec.update && !upsert) problems.push(`Pediste actualizar ${UI_SPEC_PATH}, pero la propuesta no la incluye. Pide otra propuesta.`);
  // Same file, so the same artifact: whatever ids the model wrote, it becomes an update of the existing one.
  if (upsert && spec.entityId && (upsert.tempId || upsert.entityId !== spec.entityId)) {
    const temp = upsert.tempId ?? '';
    const { tempId: _tempId, parentId: _parentId, ...rest } = upsert;
    const replaced: Op<'UPSERT_ARTIFACT'> = { ...rest, entityId: spec.entityId };
    ops = ops.map(op => (op === upsert ? replaced : op.type === 'CREATE_RELATIONSHIP' && temp ? { ...op, sourceId: op.sourceId === temp ? spec.entityId! : op.sourceId, targetId: op.targetId === temp ? spec.entityId! : op.targetId } : op));
    upsert = replaced;
  }
  if (upsert && !spec.entityId && !upsert.tempId && !upsert.entityId) upsert.tempId = '$ui_spec';
  if (upsert) upsert.artifactType = 'SPEC';
  const target = upsert ? (upsert.entityId && !upsert.tempId ? upsert.entityId : upsert.tempId ?? null) : spec.entityId;
  if (target) {
    const touched = [...ops.filter((op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE').map(op => op.tempId), ...ops.flatMap(op => (op.type === 'CREATE_WORK_ITEM' && graph.features?.has(op.parentId) ? [op.parentId] : []))];
    for (const feature of new Set(touched)) {
      if (target === spec.entityId && graph.linked?.has(feature)) continue;
      if (!ops.some(op => op.type === 'CREATE_RELATIONSHIP' && op.edgeType === 'DOCUMENTED_BY' && op.sourceId === feature && op.targetId === target)) ops.push({ type: 'CREATE_RELATIONSHIP', sourceId: feature, targetId: target, edgeType: 'DOCUMENTED_BY' });
    }
  }
  return { operations: ops, problems };
}
