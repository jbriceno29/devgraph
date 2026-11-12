import type { EdgeProvenance, GraphEdgeType, KnowledgeEntityType } from '../kernel/graph.js';

export type { EdgeProvenance, GraphEdgeType, KnowledgeEntityType } from '../kernel/graph.js';
/** The context that reached a task's latest run: which graph entities, at which authority tier, and the conventions in force. */
export interface ContextFlowDto {
  executionId: string | null;
  snapshotId: string | null;
  sources: Array<{ entityId: string; tier: number; origin: string }>;
  conventions: string[];
}
export interface GraphNodeView {
  id: string;
  key: string;
  type: KnowledgeEntityType;
  subType?: string;
  label: string;
  status: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}
export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  provenance: EdgeProvenance;
}
