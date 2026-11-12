import type { ContextEntityRecord, ContextProjectRecord } from './ports/context-engine-port.js';
import type { ContextAuthorityTier, ContextSourceEntry, ExcludedSourceEntry } from '../domain/context-snapshot.js';
import type { GraphEdgeType } from '../../../shared/contracts/graph-view.js';
export interface ContextCandidate {
  sourceId: string;
  entityKey?: string;
  sourceType: ContextSourceEntry['sourceType'];
  titleOrPath: string;
  authorityTier: ContextAuthorityTier;
  retrievalOrigin: ContextSourceEntry['retrievalOrigin'];
  viaEdgeType?: GraphEdgeType;
  graphDistance: number;
  content: string;
  contentHash: string;
  relevanceScore: number;
  record?: ContextEntityRecord;
  /** Code passed as a pointer to read in the worktree (its file is not loaded). */
  pointer?: boolean;
}
export interface ResolvedContext {
  project: ContextProjectRecord;
  focus: ContextEntityRecord /** Other tasks a grouped run covers: anchors like the focus (tier 3), without their own hierarchy. */;
  extraFocus: ContextEntityRecord[];
  entities: Map<string, ContextEntityRecord>;
  relationships: import('../../knowledge/index.js').GraphRelationship[];
  ancestors: ContextEntityRecord[];
  constraints: string[];
  candidates: ContextCandidate[];
  excluded: ExcludedSourceEntry[];
  query: string;
  maxHops: number;
  repositoryCommit: string;
  sourceCommit?: string;
  executionId?: string;
}
