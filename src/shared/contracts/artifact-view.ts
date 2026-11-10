export type ArtifactType='PRD'|'ARCHITECTURE'|'SPEC'|'IMPLEMENTATION_PLAN'|'DOMAIN_DOC'|'OTHER';
export type ArtifactSyncStatus='SYNCED'|'DRIFTED'|'MISSING'|'UNTRACKED';
export interface ArtifactDocumentDto { id:string; projectId:string; displayKey:string; title:string; summary:string; entityType:'ARTIFACT'|'DECISION_RECORD'; artifactType:string|null; version:number|null; adrNumber:number|null; relativePath:string; contentHash:string; syncStatus:ArtifactSyncStatus }
export interface ArtifactDocumentViewDto { document:ArtifactDocumentDto; content:string }
export interface CreateArtifactDocumentInput { projectId:string; entityType:'ARTIFACT'|'DECISION_RECORD'; title:string; artifactType?:ArtifactType; targetEntityId:string }
export interface ArtifactSyncStatusChangedDto { projectId:string; documentId:string; relativePath:string; syncStatus:ArtifactSyncStatus }
