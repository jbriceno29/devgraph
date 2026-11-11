import type { KnowledgeEntity,GraphRelationship } from '../../domain/graph/knowledge-entity.js';
import type { ContextSnapshot } from '../../domain/knowledge/context-snapshot.js';
export interface ContextProjectRecord {id:string;name:string;currentRevision:number;rules:string[];repositoryPath:string|null}
export interface ContextEntityRecord {entity:KnowledgeEntity;attributes:Record<string,unknown>;bodyContent:string}
export interface ContextSearchHit {record:ContextEntityRecord;relevanceScore:number}
export interface ContextExecutionSummary {id:string;status:string;completedAt:string|null;resultSummary:string|null}
export interface TraversedRelationship {relationship:GraphRelationship;graphDistance:number}
export interface ContextRepositoryPort {
 findProjectContext(projectId:string):ContextProjectRecord|null;
 listEntities(projectId:string):KnowledgeEntity[];
 listRelationships(projectId:string):GraphRelationship[];
 traverseGraph(projectId:string,startEntityIds:string[],maxHops:number):TraversedRelationship[];
 findEntityRecord(entityId:string):ContextEntityRecord|null;
 search(projectId:string,query:string,limit:number):ContextSearchHit[];
 listExecutionSummaries(workItemId:string):ContextExecutionSummary[];
 /** Every accepted task's outcome in the project, oldest first. */
 listTaskOutcomes(projectId:string):import('../../domain/work-management/task-outcome.js').TaskOutcome[];
 findTaskOutcome(workItemId:string):import('../../domain/work-management/task-outcome.js').TaskOutcome|null;
 updateArtifactDrift(entityId:string,contentHash:string,bodyContent:string):void;
 persistSnapshot(snapshot:ContextSnapshot):void;
 findSnapshot(snapshotId:string):ContextSnapshot|null;
}
export interface ContextFilePort {getHeadCommit(repositoryRoot:string):Promise<string>;readRepositoryFile(repositoryRoot:string,relativePath:string,commit?:string):Promise<{content:string;contentHash:string}>;hashContent(content:string):string}
