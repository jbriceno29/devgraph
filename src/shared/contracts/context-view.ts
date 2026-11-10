import type { GraphEdgeType } from './graph-view.js';
export type ContextAuthorityTier=1|2|3|4|5|6;
export interface ContextSourceEntryDto {sourceId:string;entityKey?:string;sourceType:'POLICY'|'ADR'|'REQUIREMENT'|'SPECIFICATION'|'WORK_ITEM'|'CODE_FILE'|'DOC'|'CHAT_NOTE';titleOrPath:string;authorityTier:ContextAuthorityTier;retrievalOrigin:'FOCUS_NODE'|'HIERARCHY_PARENT'|'GRAPH_EDGE'|'FULL_TEXT_SEARCH'|'SEMANTIC_SEARCH';viaEdgeType?:GraphEdgeType;graphDistance:number;contentHash:string;extractedContent:string;tokenCount:number}
export interface ExcludedSourceEntryDto {sourceId:string;titleOrPath:string;authorityTier:ContextAuthorityTier;exclusionReason:'TOKEN_BUDGET_EXCEEDED'|'SUPERSEDED_DECISION'|'LOW_RELEVANCE_SCORE'|'DRIFTED_UNVERIFIED'}
export interface ContextSnapshotDto {id:string;projectId:string;executionId:string|null;focusEntityId:string;repositoryCommit:string;graphRevision:number;createdAt:string;tokenUsage:{maxAllowedTokens:number;totalUsedTokens:number};constraints:string[];includedSources:ContextSourceEntryDto[];excludedSources:ExcludedSourceEntryDto[]}
export interface ContextPackageDto {snapshot:ContextSnapshotDto;packageText:string}
export interface PreviewContextInput {projectId:string;focusEntityId:string;maxAllowedTokens?:number;query?:string;maxHops?:number;recentNotes?:string[]}
