import type { GraphRelationship } from '../../knowledge/index.js';
import type { ResolvedContext } from './context-types.js';
import { candidateForRecord } from './context-resolver.js';

/** An edge the repository survey created (plan REP, R3): its code goes as a pointer, not as the whole file. */
export const isMappedCode = (edge: GraphRelationship) =>
  edge.edgeType === 'TOUCHES_CODE' && edge.metadata?.origin === 'SURVEY';

/** At most this many files of each kind go as pointers: the agent reads them in its worktree when it needs them. */
const MAX_POINTERS = 40;

const pointed = (context: ResolvedContext, id: string) => context.candidates.some(item => item.sourceId === id);
const liveCode = (context: ResolvedContext, id: string) => {
  const target = context.entities.get(id);
  return target && target.entity.entityType === 'CODE_REFERENCE' && target.entity.status !== 'REMOVED'
    ? target
    : undefined;
};

/** The code the informing tasks' accepted runs modified (at most 40 files), as pointers to read in the worktree. */
export function addModifiedCode(context: ResolvedContext): void {
  const informing = new Set(
    context.candidates
      .filter(
        candidate =>
          candidate.record?.entity.entityType === 'WORK_ITEM' && candidate.sourceId !== context.focus.entity.id,
      )
      .map(candidate => candidate.sourceId),
  );
  let codeReferences = 0;
  for (const edge of context.relationships) {
    if (codeReferences >= MAX_POINTERS) break;
    if (edge.edgeType !== 'MODIFIES' || !informing.has(edge.sourceId)) continue;
    const target = liveCode(context, edge.targetId);
    if (!target || pointed(context, edge.targetId)) continue;
    const source = context.entities.get(edge.sourceId);
    const candidate = candidateForRecord(target, 'GRAPH_EDGE', 3, 4, 0, 'MODIFIES');
    candidate.content = `Archivo ${String(target.attributes.file_path ?? target.entity.title)} (commit ${String(target.attributes.commit_sha ?? '').slice(0, 12)}), modificado por ${source?.entity.displayKey ?? 'una tarea'}: ${source?.entity.title ?? ''}. Léelo en el worktree si lo necesitas.`;
    context.candidates.push(candidate);
    codeReferences += 1;
  }
}

/**
 * Plan REP, R3: the files the map says make up the focus's feature and module (TOUCHES_CODE), nearest anchor first,
 * as pointers (tier 4). A new task under an existing module learns where its code already lives without reading it all.
 */
export function addMappedCode(context: ResolvedContext): void {
  const anchors = [context.focus, ...(context.extraFocus ?? []), ...context.ancestors];
  let added = 0;
  for (const [distance, anchor] of anchors.entries())
    for (const edge of context.relationships) {
      if (added >= MAX_POINTERS) return;
      if (!isMappedCode(edge) || edge.sourceId !== anchor.entity.id) continue;
      const target = liveCode(context, edge.targetId);
      if (!target || pointed(context, edge.targetId)) continue;
      const candidate = candidateForRecord(target, 'GRAPH_EDGE', Math.min(distance + 1, 3), 4, 0, 'TOUCHES_CODE');
      candidate.pointer = true;
      candidate.content = `Archivo ${String(target.attributes.file_path ?? target.entity.title)}: código que ya existe de ${anchor.entity.displayKey} «${anchor.entity.title}» (mapa del código). Léelo en el worktree si lo necesitas.`;
      context.candidates.push(candidate);
      added += 1;
    }
}
