import type { KnowledgeEntity } from '../graph/knowledge-entity.js';
export interface ProjectRoot extends KnowledgeEntity { entityType: 'PROJECT_ROOT' }
export interface Module extends KnowledgeEntity { entityType: 'MODULE'; purpose: string; domainBoundary: string | null; moduleKind: 'FUNCTIONAL'|'TECHNICAL'|'SHARED' }
export interface Feature extends KnowledgeEntity { entityType: 'FEATURE'; scope: string; priority: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; businessValue: string | null; complexityEstimate: number | null }
export interface AcceptanceCriterion { id: string; description: string; verified: boolean; verificationRef?: string }
export interface Requirement extends KnowledgeEntity { entityType: 'REQUIREMENT'; reqType: 'FUNCTIONAL'|'NON_FUNCTIONAL'|'CONSTRAINT'; priority: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; acceptanceCriteria: AcceptanceCriterion[]; verificationMethod: string | null }
export type WorkItemType = 'TASK'|'BUG'|'SPIKE'|'IMPROVEMENT';
export type WorkItemStatus = 'DRAFT'|'READY'|'BLOCKED'|'IN_PROGRESS'|'IN_REVIEW'|'DONE'|'ARCHIVED';
export interface WorkItem extends KnowledgeEntity { entityType: 'WORK_ITEM'; workType: WorkItemType; priority: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; scopeNotes: string | null; acceptanceCriteria: AcceptanceCriterion[]; recommendedProfileRole: 'PLANNER'|'ARCHITECT'|'DEVELOPER'|'REVIEWER'|'KNOWLEDGE_MANAGER'|null }
export interface Milestone extends KnowledgeEntity { entityType: 'MILESTONE'; versionTag: string; objectives: string[]; targetDate: string | null; completedAt: string | null }
const transitions: Readonly<Record<WorkItemStatus, readonly WorkItemStatus[]>> = { DRAFT:['READY','ARCHIVED'], READY:['BLOCKED','IN_PROGRESS','ARCHIVED'], BLOCKED:['READY','ARCHIVED'], IN_PROGRESS:['BLOCKED','IN_REVIEW','ARCHIVED'], IN_REVIEW:['DONE','IN_PROGRESS','BLOCKED','ARCHIVED'], DONE:['ARCHIVED'], ARCHIVED:[] };
export function canTransitionWorkItem(from: WorkItemStatus, to: WorkItemStatus): boolean { return transitions[from].includes(to); }
export function transitionWorkItem<T extends WorkItem>(item: T, to: WorkItemStatus): T {
  if (!canTransitionWorkItem(item.status as WorkItemStatus, to)) throw new Error(`Invalid WorkItem transition: ${item.status} -> ${to}`);
  return { ...item, status: to };
}
