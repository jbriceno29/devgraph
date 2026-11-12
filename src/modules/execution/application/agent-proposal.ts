import { decide, extractProposalBlock, normalizeDecisionPolicy } from '../../autopilot/index.js';
import type { ChangeOperation, WorkItemStatus } from '../../knowledge/index.js';
import type { AgentExecution } from '../domain/models.js';
import { type ExecutionKernel, unblockDependents } from './execution-kernel.js';
import { getPolicy } from './execution-policy.js';

export interface PlanProposalOutcome {
  changeSetId: string | null;
  outcome: 'APPLIED' | 'PENDING' | 'INVALID';
  reasons: string[];
  title: string;
}

/**
 * Stage 3: the plan change the agent proposed when closing the task (```propuestas block). Classified with the project's
 * decision policy: applied on its own when every operation is AUTO, otherwise left pending in the ChangeSet list.
 * Never throws: the task is already integrated, a bad proposal only reports why.
 */
export async function handleProposal(
  k: ExecutionKernel,
  execution: AgentExecution,
  summary: string,
): Promise<PlanProposalOutcome | null> {
  if (!k.planProposals || !execution.workItemId) return null;
  const block = extractProposalBlock(summary);
  if (!block) return null;
  const invalid = (
    reason: string,
    title = 'Propuesta del agente',
    changeSetId: string | null = null,
  ): PlanProposalOutcome => ({ changeSetId, outcome: 'INVALID', reasons: [reason], title });
  if ('error' in block) return invalid(block.error);
  const projectId = execution.projectId,
    raw = block.raw as { title?: unknown; rationale?: unknown; operations?: unknown } | null;
  const title =
    typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 200) : 'Propuesta del agente';
  try {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.operations) || !raw.operations.length)
      return invalid('La propuesta no trae operaciones.', title);
    const feature = k.repository.findFeatureFor(projectId, execution.workItemId);
    const tasks = feature ? k.repository.listFeatureTasks(projectId, feature.id) : [];
    const operations = proposedOperations(k, raw.operations, feature, tasks);
    const policy = normalizeDecisionPolicy(getPolicy(k, projectId).decisionPolicy);
    const featureTasks = new Set(tasks.map(task => task.id));
    const autoTasksSoFar = feature ? autoTasksOf(k, projectId, feature.id, featureTasks) : 0;
    const verdict = decide(operations as Array<{ type: string; [key: string]: unknown }>, policy, {
      featureTasks,
      featureId: feature?.id ?? '',
      autoTasksSoFar,
    });
    const submitted = await k.planProposals.submit(
      projectId,
      { title, rationale: typeof raw.rationale === 'string' ? raw.rationale : '', operations },
      execution.id,
    );
    if (submitted.status !== 'VALIDATED')
      return invalid(submitted.issues.join(' ') || 'El validador rechazó la propuesta.', title, submitted.changeSetId);
    if (verdict.mode !== 'AUTO')
      return { changeSetId: submitted.changeSetId, outcome: 'PENDING', reasons: verdict.reasons, title };
    const applied = await k.planProposals.apply(submitted.changeSetId);
    settleTasks(k, projectId, operations, applied.resolvedIds);
    return { changeSetId: submitted.changeSetId, outcome: 'APPLIED', reasons: [], title };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error), title);
  }
}

/**
 * New tasks are born DRAFT: READY when every dependency is DONE, BLOCKED otherwise. Existing tasks touched by the
 * proposal follow the same rule (a READY task with a new unfinished prerequisite becomes BLOCKED, and vice versa).
 */
export function settleTasks(
  k: ExecutionKernel,
  projectId: string,
  operations: ChangeOperation[],
  resolvedIds: Record<string, string>,
): void {
  const resolve = (id: string) => resolvedIds[id] ?? id;
  const touched = new Set<string>();
  for (const op of operations) {
    if (op.type === 'CREATE_WORK_ITEM' && resolvedIds[op.tempId]) touched.add(resolvedIds[op.tempId]!);
    if (op.type === 'CREATE_RELATIONSHIP' && op.edgeType === 'DEPENDS_ON') {
      touched.add(resolve(op.sourceId));
      touched.add(resolve(op.targetId));
    }
  }
  for (const id of touched) {
    try {
      const task = k.repository.findWorkItem(projectId, id);
      if (!task) continue;
      const pending = k.repository.listDependencies(projectId, id).some(dependency => dependency.status !== 'DONE');
      const target: WorkItemStatus | null =
        task.status === 'DRAFT'
          ? pending
            ? 'BLOCKED'
            : 'READY'
          : task.status === 'READY' && pending
            ? 'BLOCKED'
            : task.status === 'BLOCKED' && !pending
              ? 'READY'
              : null;
      if (!target) continue;
      const revision = k.repository.transitionWorkItem(projectId, id, target);
      k.emit('graph:revision_updated', { projectId, revision });
    } catch {
      /* left as is */
    }
  }
  for (const id of touched) {
    const task = k.repository.findWorkItem(projectId, id);
    if (task?.status === 'DONE') unblockDependents(k, projectId, id);
  }
}

type Ref = { id: string; displayKey: string };

/** The proposal's operations with the keys of the prompt (TASK-003, FEAT-001) turned into ids, normalized. */
function proposedOperations(k: ExecutionKernel, raw: unknown[], feature: Ref | null, tasks: Ref[]): ChangeOperation[] {
  // The prompt shows ids and keys; accept either.
  const keys = new Map<string, string>([
    ...tasks.map(task => [task.displayKey, task.id] as const),
    ...(feature ? [[feature.displayKey, feature.id] as const] : []),
  ]);
  return k.planProposals!.normalize(
    raw.map(item => {
      if (!item || typeof item !== 'object') return item;
      const op = { ...(item as Record<string, unknown>) };
      for (const field of ['parentId', 'sourceId', 'targetId', 'entityId', 'moduleId'])
        if (typeof op[field] === 'string' && keys.has(op[field] as string)) op[field] = keys.get(op[field] as string);
      return op;
    }),
  );
}

/** Tasks the agent already added to this feature on its own (the decision policy caps them). */
function autoTasksOf(k: ExecutionKernel, projectId: string, featureId: string, featureTasks: Set<string>): number {
  return k
    .planProposals!.appliedAgentOperations(projectId)
    .flat()
    .filter(op => op.type === 'CREATE_WORK_ITEM' && (op.parentId === featureId || featureTasks.has(op.parentId)))
    .length;
}
