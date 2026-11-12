import type { GraphEdgeType } from '../../../shared/kernel/graph.js';
import type { AgentProfileRole } from '../../execution/index.js';
export type ChangeSetStatus = 'PENDING_APPROVAL' | 'VALIDATED' | 'CONFLICTED' | 'APPLIED' | 'REJECTED';
export type ChangeSetOriginType = 'AI_CHAT' | 'AGENT_EXECUTION' | 'USER_BULK_ACTION';
export type ChangeOperation =
  | {
      type: 'CREATE_MODULE';
      tempId: string;
      parentId?: string | null;
      title: string;
      summary: string;
      purpose: string;
      moduleKind?: 'FUNCTIONAL' | 'TECHNICAL' | 'SHARED';
    }
  | {
      type: 'CREATE_FEATURE';
      tempId: string;
      moduleId: string;
      title: string;
      summary: string;
      scope: string;
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }
  | {
      type: 'CREATE_REQUIREMENT';
      tempId: string;
      parentId?: string | null;
      title: string;
      summary: string;
      reqType: 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'CONSTRAINT';
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      acceptanceCriteria: string[];
    }
  | {
      type: 'CREATE_WORK_ITEM';
      tempId: string;
      parentId: string;
      workType: 'TASK' | 'BUG' | 'SPIKE' | 'IMPROVEMENT';
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      title: string;
      summary: string;
      acceptanceCriteria: string[];
      recommendedProfileRole?: AgentProfileRole;
    }
  | {
      type: 'CREATE_DECISION_RECORD';
      tempId: string;
      title: string;
      contextMd: string;
      alternativesMd: string;
      decisionMd: string;
      consequencesMd: string;
      relativePath: string;
    }
  | {
      type: 'UPSERT_ARTIFACT';
      tempId?: string;
      entityId?: string;
      parentId?: string | null;
      artifactType: 'PRD' | 'ARCHITECTURE' | 'SPEC' | 'IMPLEMENTATION_PLAN' | 'DOMAIN_DOC' | 'OTHER';
      title: string;
      relativePath: string;
      markdownContent: string;
    }
  | { type: 'UPDATE_ENTITY_STATUS'; entityId: string; newStatus: string; reason: string }
  | {
      type: 'CREATE_RELATIONSHIP';
      sourceId: string;
      targetId: string;
      edgeType: GraphEdgeType;
      metadata?: Record<string, unknown>;
    }
  | { type: 'DELETE_RELATIONSHIP'; edgeId: string; reason: string }
  /** Project profile (inception): goal, scope, stack, level-1 rules and verification commands. Replaces each field it carries. */
  | ({ type: 'SET_PROJECT_PROFILE' } & ProjectProfile);
export interface ProjectProfile {
  description?: string /** Stack profile of the catalog the project follows (stack-catalog.ts). */;
  stackProfileId?: string;
  objectives: string[];
  outOfScope: string[];
  techStack: Record<string, string>;
  rules: string[];
  verificationCommands: string[];
  /** Existing repository (plan REP, R1): what the agent may write, replacing the defaults for a new project. */
  writablePaths?: string[];
}
export interface ChangeSet {
  id: string;
  projectId: string;
  baseGraphRevision: number;
  appliedGraphRevision?: number;
  originType: ChangeSetOriginType;
  originRefId?: string;
  title: string;
  rationale: string;
  status: ChangeSetStatus;
  operations: ChangeOperation[];
  validationIssues: Array<{ operationIndex: number; severity: 'ERROR' | 'WARNING'; code: string; message: string }>;
  createdAt: string;
  appliedAt?: string;
}

const transitions: Readonly<Record<ChangeSetStatus, readonly ChangeSetStatus[]>> = {
  PENDING_APPROVAL: ['VALIDATED', 'CONFLICTED', 'REJECTED'],
  VALIDATED: ['PENDING_APPROVAL', 'CONFLICTED', 'APPLIED', 'REJECTED'],
  CONFLICTED: ['PENDING_APPROVAL', 'REJECTED'],
  APPLIED: [],
  REJECTED: [],
};
export function canTransitionChangeSet(from: ChangeSetStatus, to: ChangeSetStatus): boolean {
  return transitions[from].includes(to);
}
export function transitionChangeSet(
  changeSet: ChangeSet,
  to: ChangeSetStatus,
  patch: Partial<ChangeSet> = {},
): ChangeSet {
  if (!canTransitionChangeSet(changeSet.status, to))
    throw new Error(`Invalid ChangeSet transition: ${changeSet.status} -> ${to}`);
  return { ...changeSet, ...patch, status: to };
}
