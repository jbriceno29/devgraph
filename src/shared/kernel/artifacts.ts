/** Kinds and sync states of the Markdown documents, shared by the domain and the contracts. */
export type ArtifactType = 'PRD' | 'ARCHITECTURE' | 'SPEC' | 'IMPLEMENTATION_PLAN' | 'DOMAIN_DOC' | 'OTHER';
export type ArtifactSyncStatus = 'SYNCED' | 'DRIFTED' | 'MISSING' | 'UNTRACKED';
