import type { KnowledgeEntity, GraphRelationship } from '../../domain/graph/knowledge-entity.js';
import type { ArtifactSyncStatus } from '../../domain/artifacts/entities.js';

export interface RepositoryLocation { id:string; projectId:string; name:string; localPath:string; defaultBranch:string; headCommit:string|null }
export interface ArtifactDocumentRecord {
  id:string; projectId:string; displayKey:string; title:string; summary:string;
  entityType:'ARTIFACT'|'DECISION_RECORD'; artifactType:string|null; version:number|null;
  adrNumber:number|null; relativePath:string; contentHash:string; syncStatus:ArtifactSyncStatus;
  contextMd:string|null; alternativesMd:string|null; decisionMd:string|null; consequencesMd:string|null;
}
export interface ArtifactDocumentCreateRecord { entity:KnowledgeEntity; relativePath:string; contentHash:string; bodyContent:string; artifactType:string; repositoryId:string; version:number; link:GraphRelationship }
export interface DecisionRecordCreateRecord { entity:KnowledgeEntity; relativePath:string; contentHash:string; bodyContent:string; repositoryId:string; adrNumber:number; contextMd:string; alternativesMd:string; decisionMd:string; consequencesMd:string; decidedAt:string; link:GraphRelationship }

export interface RepositoryLocationRepositoryPort {
  findPrimaryForProject(projectId:string):RepositoryLocation|null;
  setPrimary(projectId:string, localPath:string):RepositoryLocation;
}
export interface ArtifactRepositoryPort {
  listDocuments(projectId:string):ArtifactDocumentRecord[];
  findDocumentById(id:string):ArtifactDocumentRecord|null;
  findDocumentByPath(projectId:string, relativePath:string):ArtifactDocumentRecord|null;
  createArtifact(record:ArtifactDocumentCreateRecord):void;
  createDecisionRecord(record:DecisionRecordCreateRecord):void;
  updateDocumentContent(id:string, contentHash:string, syncStatus:ArtifactSyncStatus, bodyContent:string, fields?:{title?:string;contextMd?:string;alternativesMd?:string;decisionMd?:string;consequencesMd?:string}):void;
}

export interface MarkdownFileResult { content:string; contentHash:string }
export interface AtomicMarkdownFilePort {
  resolveGitRepository(path:string):Promise<string>;
  ensureDocsDirectory(repositoryRoot:string):Promise<void>;
  readMarkdown(repositoryRoot:string, relativePath:string):Promise<MarkdownFileResult>;
  markdownExists(repositoryRoot:string, relativePath:string):Promise<boolean>;
  writeMarkdownAtomically(repositoryRoot:string, relativePath:string, content:string):Promise<MarkdownFileResult>;
  removeMarkdown(repositoryRoot:string, relativePath:string):Promise<void>;
  watchDocs(repositoryRoot:string, onChange:(relativePath:string|null)=>void):()=>void;
}

export interface ArtifactSyncStatusChangedEvent { projectId:string; documentId:string; relativePath:string; syncStatus:ArtifactSyncStatus }
