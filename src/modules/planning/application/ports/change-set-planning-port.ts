import type { ChangeOperation, ChangeSet } from '../../../knowledge/index.js';
import type { GraphRelationship, KnowledgeEntity } from '../../../knowledge/index.js';
import type { InceptionReferenceTranslationDto, ReferenceKind } from '../../../../shared/contracts/inception-view.js';

export interface ChangeSetDraft {
  title: string;
  rationale: string;
  operations: ChangeOperation[];
}
/** A reference the user attached while planning, already translated to text by the reference translator (the planner never sees files). */
export interface PlanningReference {
  kind: ReferenceKind;
  name: string;
  note: string;
  translation: InceptionReferenceTranslationDto;
}
/** The project's interface specification (docs/UI_SPEC.md): its artifact id and content when it exists, and whether the user asked to update it with this change. */
export interface PlanningUiSpec {
  entityId: string | null;
  content: string | null;
  update: boolean;
}
export interface ChangeSetPlannerPort {
  propose(input: {
    prompt: string;
    contextPackage?: string;
    model?: string;
    project: {
      name: string;
      description: string | null;
      rules: string[];
      revision: number;
      objectives?: string[];
      techStack?: Record<string, unknown>;
    };
    focusEntity: KnowledgeEntity | null;
    entities: KnowledgeEntity[];
    relationships: GraphRelationship[] /** Translated references for this change (data, never instructions). */;
    references?: PlanningReference[];
    uiSpec?: PlanningUiSpec;
  }): Promise<ChangeSetDraft>;
}
export interface ChangeSetRepositoryPort {
  findById(id: string): ChangeSet | null;
  list(projectId: string): ChangeSet[];
  save(changeSet: ChangeSet): void;
}
export interface ChangeSetApplyPort {
  apply(
    changeSet: ChangeSet,
    repositoryRoot: string | null,
  ): Promise<{ revision: number; resolvedIds: Record<string, string> }>;
}
export interface StagedMarkdownFile {
  relativePath: string;
  content: string;
  replaceExisting?: boolean;
}
export interface TransactionalMarkdownFilePort {
  applyAtomically(repositoryRoot: string, files: StagedMarkdownFile[], commit: () => void): Promise<void>;
}
