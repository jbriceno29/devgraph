import type { FeatureIntegrationStateDto } from './agent-view.js';
import type { GraphEdgeType, GraphNodeView } from './graph-view.js';

/** What the inspector shows for one entity of the graph. */
export interface RelationshipViewDto {
  id: string;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  type: GraphEdgeType;
  direction: 'INCOMING' | 'OUTGOING';
  provenance: 'USER' | 'CHANGESET' | 'EXECUTION';
}
export interface EntityInspectorDto {
  entity: GraphNodeView & { summary: string };
  attributes: Record<string, unknown>;
  relationships: RelationshipViewDto[];
  allowedStatusChanges?: string[];
  outcome?: {
    summary: string;
    files: Array<{ path: string; status: string }>;
    checks: Array<{ command: string; passed: boolean }>;
    mergedCommit: string | null;
    integrationBranch: string | null;
    createdAt: string;
  } /** FEATURE only, when it has an integration branch: what «Integrar» needs (no git calls). */;
  integration?: FeatureIntegrationStateDto;
  executionHistory: Array<{
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    resultSummary: string | null;
  }>;
}
