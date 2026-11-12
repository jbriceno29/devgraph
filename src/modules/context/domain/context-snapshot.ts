import type { GraphEdgeType } from '../../../shared/kernel/graph.js';
export type ContextAuthorityTier = 1 | 2 | 3 | 4 | 5 | 6;
export interface ContextSourceEntry {
  sourceId: string;
  entityKey?: string;
  sourceType: 'POLICY' | 'ADR' | 'REQUIREMENT' | 'SPECIFICATION' | 'WORK_ITEM' | 'CODE_FILE' | 'DOC' | 'CHAT_NOTE';
  titleOrPath: string;
  authorityTier: ContextAuthorityTier;
  retrievalOrigin: 'FOCUS_NODE' | 'HIERARCHY_PARENT' | 'GRAPH_EDGE' | 'FULL_TEXT_SEARCH' | 'SEMANTIC_SEARCH';
  viaEdgeType?: GraphEdgeType;
  graphDistance: number;
  contentHash: string;
  extractedContent: string;
  tokenCount: number;
}
export interface ExcludedSourceEntry {
  sourceId: string;
  titleOrPath: string;
  authorityTier: ContextAuthorityTier;
  exclusionReason: 'TOKEN_BUDGET_EXCEEDED' | 'SUPERSEDED_DECISION' | 'LOW_RELEVANCE_SCORE' | 'DRIFTED_UNVERIFIED';
}
export interface ContextSnapshot {
  id: string;
  projectId: string;
  executionId: string | null;
  focusEntityId: string;
  repositoryCommit: string;
  graphRevision: number;
  createdAt: string;
  tokenUsage: { maxAllowedTokens: number; totalUsedTokens: number };
  constraints: string[];
  includedSources: ContextSourceEntry[];
  excludedSources: ExcludedSourceEntry[];
}
