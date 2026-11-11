import type { ChangeOperation, ChangeSet } from '../../domain/knowledge/change-set.js';
import type { GraphRelationship, KnowledgeEntity } from '../../domain/graph/knowledge-entity.js';

export interface ChangeSetDraft { title:string; rationale:string; operations:ChangeOperation[] }
export interface ChangeSetPlannerPort { propose(input:{prompt:string;contextPackage?:string;model?:string;project:{name:string;description:string|null;rules:string[];revision:number;objectives?:string[];techStack?:Record<string,unknown>};focusEntity:KnowledgeEntity|null;entities:KnowledgeEntity[];relationships:GraphRelationship[]}):Promise<ChangeSetDraft> }
export interface ChangeSetRepositoryPort { findById(id:string):ChangeSet|null; list(projectId:string):ChangeSet[]; save(changeSet:ChangeSet):void }
export interface ChangeSetApplyPort { apply(changeSet:ChangeSet,repositoryRoot:string|null):Promise<{revision:number;resolvedIds:Record<string,string>}> }
export interface StagedMarkdownFile { relativePath:string; content:string; replaceExisting?:boolean }
export interface TransactionalMarkdownFilePort { applyAtomically(repositoryRoot:string,files:StagedMarkdownFile[],commit:()=>void):Promise<void> }
