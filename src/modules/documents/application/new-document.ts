import type { GraphRelationship, KnowledgeEntity } from '../../knowledge/index.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../../shared/contracts/graph-view.js';
import type { CreateDocumentInput } from './artifact-management-service.js';
import {
  artifactPath,
  createArtifactTemplate,
  createDecisionRecordTemplate,
  decisionRecordPath,
  nextDocumentNumber,
} from './artifact-templates.js';
import type { ArtifactRepositoryPort } from './ports/artifact-management-port.js';

type Records = ReturnType<ArtifactRepositoryPort['listDocuments']>;
type Link = (sourceId: string, targetId: string, edgeType: GraphEdgeType) => GraphRelationship;

/** Path, template, key and graph link of a new document: an ARTIFACT documents the target, an ADR affects it. */
export function draftDocument(
  input: CreateDocumentInput,
  title: string,
  targetId: string,
  entityId: string,
  records: Records,
  link: Link,
): { relativePath: string; content: string; displayKey: string; link: GraphRelationship } {
  if (input.entityType === 'ARTIFACT') {
    const artifactType = input.artifactType ?? 'OTHER';
    return {
      relativePath: artifactPath(artifactType, title),
      content: createArtifactTemplate(artifactType, title),
      displayKey: `DOC-${String(nextDocumentNumber(records, 'DOC')).padStart(3, '0')}`,
      link: link(targetId, entityId, 'DOCUMENTED_BY'),
    };
  }
  const adrNumber = nextDocumentNumber(records, 'ADR');
  return {
    relativePath: decisionRecordPath(adrNumber),
    content: createDecisionRecordTemplate(adrNumber, title),
    displayKey: `ADR-${String(adrNumber).padStart(3, '0')}`,
    link: link(entityId, targetId, 'AFFECTS'),
  };
}

/** Stores the new document's entity, its artifact or decision row and its link. */
export function persistDocument(
  documents: ArtifactRepositoryPort,
  doc: {
    input: CreateDocumentInput;
    entity: KnowledgeEntity;
    relativePath: string;
    contentHash: string;
    content: string;
    repositoryId: string;
    records: Records;
    now: string;
    link: GraphRelationship;
  },
): void {
  const common = {
    entity: doc.entity,
    relativePath: doc.relativePath,
    contentHash: doc.contentHash,
    bodyContent: doc.content,
    repositoryId: doc.repositoryId,
    link: doc.link,
  };
  if (doc.input.entityType === 'ARTIFACT') {
    documents.createArtifact({ ...common, artifactType: doc.input.artifactType ?? 'OTHER', version: 1 });
    return;
  }
  documents.createDecisionRecord({
    ...common,
    adrNumber: nextDocumentNumber(doc.records, 'ADR'),
    contextMd: 'Describe el problema y las fuerzas que motivan esta decisión.',
    alternativesMd: 'Alternativa: ventajas y desventajas.',
    decisionMd: 'Describe la decisión tomada.',
    consequencesMd: 'Consecuencias positivas y negativas.',
    decidedAt: doc.now,
  });
}

/** The DRAFT entity of a new ARTIFACT or DECISION_RECORD at the next graph revision. */
export function documentEntity(
  input: CreateDocumentInput,
  entityId: string,
  displayKey: string,
  title: string,
  revision: number,
  now: string,
): KnowledgeEntity {
  return {
    id: entityId,
    projectId: input.projectId,
    entityType: input.entityType as KnowledgeEntityType,
    displayKey,
    title,
    summary: '',
    status: 'DRAFT',
    parentId: null,
    createdRevision: revision,
    updatedRevision: revision,
    createdAt: now,
    updatedAt: now,
  };
}
