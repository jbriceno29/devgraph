import { GraphTopologyService } from '../../knowledge/index.js';
import type { ChangeOperation, ChangeSet, WorkItemStatus } from '../../knowledge/index.js';
import type { GraphRelationship, KnowledgeEntity } from '../../knowledge/index.js';
import { canTransitionWorkItem } from '../../knowledge/index.js';
import { canTransitionDecision, decisionTransitions } from '../../knowledge/index.js';
import { profileIssues } from '../../projects/index.js';
import { UI_SPEC_PATH } from '../../../shared/ui-spec.js';
import { missingUiSpecSections } from './ui-spec-update.js';

export interface ValidationResult {
  valid: boolean;
  issues: ChangeSet['validationIssues'];
  status: 'VALIDATED' | 'CONFLICTED' | 'PENDING_APPROVAL';
}
const docOps = (operation: ChangeOperation) =>
  operation.type === 'UPSERT_ARTIFACT' || operation.type === 'CREATE_DECISION_RECORD';
const createsEntity = (operation: ChangeOperation) =>
  [
    'CREATE_MODULE',
    'CREATE_FEATURE',
    'CREATE_REQUIREMENT',
    'CREATE_WORK_ITEM',
    'CREATE_DECISION_RECORD',
    'CREATE_CODE_REFERENCE',
  ].includes(operation.type) || operation.type === 'UPSERT_ARTIFACT';
const ENTITY_TYPE: Record<string, string> = {
  CREATE_MODULE: 'MODULE',
  CREATE_FEATURE: 'FEATURE',
  CREATE_REQUIREMENT: 'REQUIREMENT',
  CREATE_WORK_ITEM: 'WORK_ITEM',
  CREATE_DECISION_RECORD: 'DECISION_RECORD',
  UPSERT_ARTIFACT: 'ARTIFACT',
  CREATE_CODE_REFERENCE: 'CODE_REFERENCE',
};
/** A feature may start done or partial when the repository survey found it already built (plan REP, R3). */
const FEATURE_STATUSES = ['DRAFT', 'READY', 'BLOCKED', 'IN_PROGRESS', 'PARTIAL', 'DONE', 'ARCHIVED'];
const WORK_ITEM_STATUSES = ['DRAFT', 'READY', 'BLOCKED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'ARCHIVED'];
const plannedId = (op: ChangeOperation, index: number) =>
  'tempId' in op && op.tempId ? op.tempId : `$artifact_${index}`;

/** The graph as the ChangeSet would leave it while it is checked: existing entities and edges plus the planned ones. */
interface Scope {
  changeSet: ChangeSet;
  currentRevision: number;
  all: KnowledgeEntity[];
  edges: GraphRelationship[];
  plannedIds: Set<string>;
  topo: GraphTopologyService;
  tempIds: Set<string>;
  paths: Set<string>;
  entityFor(id: string): KnowledgeEntity | undefined;
}
type Issue = (code: string, message: string) => void;

export class ChangeSetValidator {
  validate(
    changeSet: ChangeSet,
    currentRevision: number,
    entities: KnowledgeEntity[],
    relationships: GraphRelationship[],
  ): ValidationResult {
    const issues: ChangeSet['validationIssues'] = headerIssues(changeSet, currentRevision);
    const all = [...entities, ...plannedEntities(changeSet, currentRevision)];
    const scope: Scope = {
      changeSet,
      currentRevision,
      all,
      edges: [...relationships],
      plannedIds: new Set(all.slice(entities.length).map(entity => entity.id)),
      topo: new GraphTopologyService(),
      tempIds: new Set(),
      paths: new Set(),
      entityFor: id => all.find(entity => entity.id === id),
    };
    changeSet.operations.forEach((op, i) => {
      const issue: Issue = (code, message) => issues.push({ operationIndex: i, severity: 'ERROR', code, message });
      checkTempId(op, scope, issue);
      if (docOps(op)) checkDocument(op as Extract<ChangeOperation, { relativePath: string }>, scope, issue);
      checkOperation(op, i, scope, issue);
    });
    const conflict = issues.some(item => item.code === 'REVISION_CONFLICT');
    return {
      valid: issues.length === 0,
      issues,
      status: conflict ? 'CONFLICTED' : issues.length ? 'PENDING_APPROVAL' : 'VALIDATED',
    };
  }
}

function headerIssues(changeSet: ChangeSet, currentRevision: number): ChangeSet['validationIssues'] {
  const issues: ChangeSet['validationIssues'] = [];
  if (changeSet.baseGraphRevision !== currentRevision)
    issues.push({
      operationIndex: -1,
      severity: 'ERROR',
      code: 'REVISION_CONFLICT',
      message: `La propuesta parte de la revisión ${changeSet.baseGraphRevision}; la revisión actual es ${currentRevision}.`,
    });
  if (!changeSet.operations.length)
    issues.push({
      operationIndex: -1,
      severity: 'ERROR',
      code: 'EMPTY_CHANGESET',
      message: 'La propuesta no contiene operaciones.',
    });
  return issues;
}

/** The entities the ChangeSet creates, as drafts, so parents and edges can point at them by temporary id. */
function plannedEntities(changeSet: ChangeSet, currentRevision: number): KnowledgeEntity[] {
  return changeSet.operations.flatMap((op, i) => {
    if (!createsEntity(op) || (op.type === 'UPSERT_ARTIFACT' && op.entityId && !op.tempId)) return [];
    const parentId = 'moduleId' in op ? op.moduleId : 'parentId' in op ? (op.parentId ?? null) : null;
    return [
      {
        id: plannedId(op, i),
        projectId: changeSet.projectId,
        entityType: ENTITY_TYPE[op.type]!,
        displayKey: `TMP-${i + 1}`,
        title: 'title' in op ? op.title : op.type === 'CREATE_CODE_REFERENCE' ? op.filePath : '',
        summary: 'summary' in op ? op.summary : '',
        status: 'DRAFT',
        parentId,
        createdRevision: currentRevision + 1,
        updatedRevision: currentRevision + 1,
        createdAt: changeSet.createdAt,
        updatedAt: changeSet.createdAt,
      } as KnowledgeEntity,
    ];
  });
}

function checkTempId(op: ChangeOperation, scope: Scope, issue: Issue): void {
  if (!('tempId' in op) || !op.tempId) return;
  if (!/^\$[A-Za-z0-9_-]+$/.test(op.tempId) || scope.tempIds.has(op.tempId))
    issue('INVALID_TEMP_ID', `Identificador temporal inválido o duplicado: ${op.tempId}`);
  scope.tempIds.add(op.tempId);
}

function checkDocument(op: Extract<ChangeOperation, { relativePath: string }>, scope: Scope, issue: Issue): void {
  const path = op.relativePath;
  if (
    !path.startsWith('docs/') ||
    !path.toLowerCase().endsWith('.md') ||
    path.includes('\\') ||
    path.split('/').some(p => p === '..' || p === '.' || !p)
  )
    issue(
      'UNSAFE_DOCUMENT_PATH',
      'Los documentos deben usar una ruta relativa segura dentro de docs/ y terminar en .md.',
    );
  if (scope.paths.has(path)) issue('DUPLICATE_DOCUMENT_PATH', `La ruta ${path} aparece más de una vez.`);
  scope.paths.add(path);
  // The interface specification every feature follows can be updated, never broken: whoever writes it (planner, agent, inception, a manual edit) keeps its eight sections.
  if (op.type === 'UPSERT_ARTIFACT' && path === UI_SPEC_PATH) {
    const missing = missingUiSpecSections(op.markdownContent);
    if (missing.length)
      issue('UI_SPEC_SECTIONS', `${UI_SPEC_PATH} debe conservar sus 8 secciones; faltan: ${missing.join(', ')}.`);
  }
}

function checkOperation(op: ChangeOperation, i: number, scope: Scope, issue: Issue): void {
  if (op.type === 'UPSERT_ARTIFACT' && op.entityId && !op.tempId) {
    const entity = scope.entityFor(op.entityId);
    if (!entity || entity.entityType !== 'ARTIFACT' || entity.projectId !== scope.changeSet.projectId)
      issue('INVALID_ARTIFACT_TARGET', 'El upsert debe apuntar a un Artifact existente del proyecto.');
  } else if (createsEntity(op)) {
    checkCreate(scope.entityFor(plannedId(op, i))!, scope, issue);
    if (op.type === 'CREATE_CODE_REFERENCE' && !safeCodePath(op.filePath))
      issue('UNSAFE_CODE_PATH', `La ruta de código ${op.filePath} debe ser relativa y estar dentro del repositorio.`);
  } else if (op.type === 'CREATE_RELATIONSHIP') checkRelationship(op, i, scope, issue);
  else if (op.type === 'UPDATE_ENTITY_STATUS') checkStatus(op, scope, issue);
  else if (op.type === 'DELETE_RELATIONSHIP' && !scope.edges.some(edge => edge.id === op.edgeId))
    issue('MISSING_RELATIONSHIP', `No existe la relación ${op.edgeId}.`);
  else if (op.type === 'SET_PROJECT_PROFILE') {
    const operations = scope.changeSet.operations;
    if (
      operations.filter(item => item.type === 'SET_PROJECT_PROFILE').length > 1 &&
      operations.findIndex(item => item.type === 'SET_PROJECT_PROFILE') !== i
    )
      issue('DUPLICATE_PROFILE', 'La propuesta solo puede fijar el perfil del proyecto una vez.');
    for (const message of profileIssues(op)) issue('INVALID_PROJECT_PROFILE', message);
  }
}

function checkCreate(entity: KnowledgeEntity, scope: Scope, issue: Issue): void {
  const parentId = entity.parentId;
  const parent = parentId ? (scope.entityFor(parentId) ?? null) : null;
  if (parentId?.startsWith('$') && !scope.plannedIds.has(parentId))
    issue('MISSING_TEMP_REFERENCE', `No existe la referencia temporal ${parentId}.`);
  try {
    scope.topo.validateParent(entity, parent, scope.all);
  } catch (error) {
    issue('INVALID_PARENT', error instanceof Error ? error.message : String(error));
  }
}

function checkRelationship(
  op: Extract<ChangeOperation, { type: 'CREATE_RELATIONSHIP' }>,
  i: number,
  scope: Scope,
  issue: Issue,
): void {
  const source = scope.entityFor(op.sourceId),
    target = scope.entityFor(op.targetId);
  if (!source || !target) {
    issue('MISSING_ENDPOINT', `No existe un extremo de la relación (${op.sourceId} → ${op.targetId}).`);
    return;
  }
  try {
    scope.topo.validateEdge(source, target, op.edgeType, scope.edges);
  } catch (error) {
    issue('INVALID_RELATIONSHIP', error instanceof Error ? error.message : String(error));
  }
  scope.edges.push({
    id: `$edge_${i}`,
    projectId: scope.changeSet.projectId,
    sourceId: source.id,
    targetId: target.id,
    edgeType: op.edgeType,
    provenance: 'CHANGESET',
    changeSetId: scope.changeSet.id,
    createdRevision: scope.currentRevision + 1,
    createdAt: scope.changeSet.createdAt,
  });
}

function checkStatus(op: Extract<ChangeOperation, { type: 'UPDATE_ENTITY_STATUS' }>, scope: Scope, issue: Issue): void {
  const entity = scope.entityFor(op.entityId);
  if (!entity) issue('MISSING_ENTITY', `No existe la entidad ${op.entityId}.`);
  else if (
    entity.entityType === 'WORK_ITEM' &&
    (!WORK_ITEM_STATUSES.includes(op.newStatus) ||
      !canTransitionWorkItem(entity.status as WorkItemStatus, op.newStatus as WorkItemStatus))
  )
    issue('INVALID_STATUS_TRANSITION', `No se permite cambiar el WorkItem de ${entity.status} a ${op.newStatus}.`);
  else if (entity.entityType === 'FEATURE' && !FEATURE_STATUSES.includes(op.newStatus))
    issue('INVALID_STATUS_TRANSITION', `Una feature no puede quedar en el estado ${op.newStatus}.`);
  else if (entity.entityType === 'DECISION_RECORD' && !canTransitionDecision(entity.status, op.newStatus))
    issue(
      'INVALID_STATUS_TRANSITION',
      `La decisión ${entity.displayKey} no puede pasar de ${entity.status} a ${op.newStatus} (se permite: ${decisionTransitions(entity.status).join(', ') || 'ninguno'}).`,
    );
}

/** A repository-relative file path: no absolute paths, backslashes or `.`/`..` segments. */
function safeCodePath(path: string): boolean {
  return (
    !!path &&
    path.length <= 400 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some(part => part === '..' || part === '.' || !part)
  );
}
