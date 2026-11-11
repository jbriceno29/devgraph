export type KnowledgeEntityType = 'PROJECT_ROOT' | 'MODULE' | 'FEATURE' | 'REQUIREMENT' | 'WORK_ITEM' | 'MILESTONE' | 'DECISION_RECORD' | 'ARTIFACT' | 'CODE_REFERENCE';
export type GraphEdgeType = 'DEPENDS_ON' | 'IMPLEMENTS' | 'SATISFIES' | 'AFFECTS' | 'SUPERSEDES' | 'DOCUMENTED_BY' | 'VERIFIED_BY' | 'TOUCHES_CODE' | 'MODIFIES' | 'GENERATED_BY' | 'SCOPED_IN';
export type EdgeProvenance = 'USER' | 'CHANGESET' | 'EXECUTION';
/** The context that reached a task's latest run: which graph entities, at which authority tier, and the conventions in force. */
export interface ContextFlowDto { executionId:string|null; snapshotId:string|null; sources:Array<{entityId:string;tier:number;origin:string}>; conventions:string[] }
export interface GraphNodeView { id: string; key: string; type: KnowledgeEntityType; subType?: string; label: string; status: string; parentId?: string; metadata?: Record<string, unknown> }
export interface GraphEdgeView { id: string; source: string; target: string; type: GraphEdgeType; provenance: EdgeProvenance }
