import type { ChangeOperation } from '../../knowledge/index.js';
import type {
  InceptionFeatureDto,
  InceptionProposalDto,
  InceptionStackProfileDto,
} from '../../../shared/contracts/inception-view.js';
import { findStackProfile, profilePackages } from '../../projects/index.js';
import { FOUNDATION, type Op } from './foundation-plan.js';

/** What the wizard shows of a proposal (no ids from the graph: the plan does not exist yet). */
export function summarizeFoundationPlan(
  operations: ChangeOperation[],
): Pick<
  InceptionProposalDto,
  'profile' | 'decision' | 'documents' | 'requirements' | 'features' | 'scaffoldTaskTitle'
> {
  const profile = operations.find((op): op is Op<'SET_PROJECT_PROFILE'> => op.type === 'SET_PROJECT_PROFILE');
  const decision = operations.find((op): op is Op<'CREATE_DECISION_RECORD'> => op.type === 'CREATE_DECISION_RECORD');
  const tasks = operations.filter((op): op is Op<'CREATE_WORK_ITEM'> => op.type === 'CREATE_WORK_ITEM');
  const edges = operations.filter(
    (op): op is Op<'CREATE_RELATIONSHIP'> => op.type === 'CREATE_RELATIONSHIP' && op.edgeType === 'DEPENDS_ON',
  );
  const titles = new Map(
    operations.flatMap(op => ('tempId' in op && op.tempId && 'title' in op ? [[op.tempId, op.title] as const] : [])),
  );
  const status = new Map(
    operations.flatMap(op => (op.type === 'UPDATE_ENTITY_STATUS' ? [[op.entityId, op.newStatus] as const] : [])),
  );
  const featureOps = operations.filter((op): op is Op<'CREATE_FEATURE'> => op.type === 'CREATE_FEATURE');
  const foundation = featureOps.find(feature => FOUNDATION.test(feature.title));
  const features: InceptionFeatureDto[] = featureOps.map(feature => ({
    tempId: feature.tempId,
    title: feature.title,
    isFoundation: feature === foundation,
    dependsOn: edges
      .filter(edge => edge.sourceId === feature.tempId)
      .map(edge => titles.get(edge.targetId) ?? edge.targetId),
    tasks: tasks
      .filter(task => task.parentId === feature.tempId)
      .map(task => ({
        tempId: task.tempId,
        title: task.title,
        initialStatus: status.get(task.tempId) === 'READY' ? ('READY' as const) : ('BLOCKED' as const),
      })),
  }));
  return {
    profile: profile ? profileView(profile) : null,
    decision: decision
      ? {
          title: decision.title,
          alternativesMd: decision.alternativesMd,
          decisionMd: decision.decisionMd,
          consequencesMd: decision.consequencesMd,
        }
      : null,
    documents: operations.flatMap(op =>
      op.type === 'UPSERT_ARTIFACT' || op.type === 'CREATE_DECISION_RECORD'
        ? [{ title: op.title, relativePath: op.relativePath }]
        : [],
    ),
    requirements: operations.flatMap(op => (op.type === 'CREATE_REQUIREMENT' ? [op.title] : [])),
    features,
    scaffoldTaskTitle: foundation ? (tasks.find(task => task.parentId === foundation.tempId)?.title ?? null) : null,
  };
}

export function stackProfileView(id: string | undefined): InceptionStackProfileDto | null {
  const profile = findStackProfile(id);
  return profile
    ? { id: profile.id, title: profile.title, packages: profilePackages(profile), reviewedAt: profile.reviewedAt }
    : null;
}

function profileView(profile: Op<'SET_PROJECT_PROFILE'>) {
  return {
    description: profile.description ?? null,
    objectives: profile.objectives,
    outOfScope: profile.outOfScope,
    techStack: profile.techStack,
    rules: profile.rules,
    verificationCommands: profile.verificationCommands,
    stackProfile: stackProfileView(profile.stackProfileId),
  };
}
