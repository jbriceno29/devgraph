import type { KnowledgeEntity } from '../../knowledge/index.js';
import type { ArtifactSyncStatus, ArtifactType } from '../../../shared/kernel/artifacts.js';
export type { ArtifactSyncStatus } from '../../../shared/kernel/artifacts.js';
export interface ArtifactSyncState {
  contentHash: string;
  syncStatus: ArtifactSyncStatus;
  lastCheckedAt: string;
}
export interface DecisionRecord extends KnowledgeEntity {
  entityType: 'DECISION_RECORD';
  adrNumber: number;
  contextMd: string;
  alternativesMd: string;
  decisionMd: string;
  consequencesMd: string;
  relativePath: string;
  contentHash: string;
  syncStatus: ArtifactSyncStatus;
  decidedAt: string;
}
export interface Artifact extends KnowledgeEntity {
  entityType: 'ARTIFACT';
  repositoryId: string;
  artifactType: ArtifactType;
  relativePath: string;
  version: number;
  contentHash: string;
  syncStatus: ArtifactSyncStatus;
}
export interface CodeReference extends KnowledgeEntity {
  entityType: 'CODE_REFERENCE';
  repositoryId: string;
  filePath: string;
  symbolName: string | null;
  symbolKind: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  commitSha: string;
}
