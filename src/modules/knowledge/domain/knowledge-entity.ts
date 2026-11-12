import type { KnowledgeEntityType, GraphEdgeType, EdgeProvenance } from '../../../shared/contracts/graph-view.js';
export interface KnowledgeEntity {
  id: string;
  projectId: string;
  entityType: KnowledgeEntityType;
  displayKey: string;
  title: string;
  summary: string;
  status: string;
  parentId: string | null;
  createdRevision: number;
  updatedRevision: number;
  createdAt: string;
  updatedAt: string;
}
export interface GraphRelationship {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  edgeType: GraphEdgeType;
  provenance: EdgeProvenance;
  changeSetId?: string | null;
  executionId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdRevision: number;
  createdAt: string;
}
