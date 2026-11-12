/** The graph's vocabulary, shared by the domain and the contracts the interface reads (CLAUDE.md, rule 1). */
export type KnowledgeEntityType =
  | 'PROJECT_ROOT'
  | 'MODULE'
  | 'FEATURE'
  | 'REQUIREMENT'
  | 'WORK_ITEM'
  | 'MILESTONE'
  | 'DECISION_RECORD'
  | 'ARTIFACT'
  | 'CODE_REFERENCE';
export type GraphEdgeType =
  | 'DEPENDS_ON'
  | 'IMPLEMENTS'
  | 'SATISFIES'
  | 'AFFECTS'
  | 'SUPERSEDES'
  | 'DOCUMENTED_BY'
  | 'VERIFIED_BY'
  | 'TOUCHES_CODE'
  | 'MODIFIES'
  | 'GENERATED_BY'
  | 'SCOPED_IN';
export type EdgeProvenance = 'USER' | 'CHANGESET' | 'EXECUTION';
