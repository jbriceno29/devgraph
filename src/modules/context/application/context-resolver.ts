import { extractConventions } from '../../execution/index.js';
import { renderProfileForContext } from '../../projects/index.js';
import type { ContextEntityRecord, ContextFilePort, ContextRepositoryPort } from './ports/context-engine-port.js';
import type { ResolvedContext, ContextCandidate } from './context-types.js';

export class ContextResolver {
  constructor(
    private readonly repository: ContextRepositoryPort,
    private readonly files: ContextFilePort,
  ) {}
  async resolve(input: ResolveInput): Promise<ResolvedContext> {
    const project = this.repository.findProjectContext(input.projectId);
    if (!project) throw new Error('Proyecto no encontrado para resolver el contexto.');
    const entities = new Map(this.repository.listEntities(input.projectId).map(entity => [entity.id, entity]));
    const focusEntity = entities.get(input.focusEntityId);
    if (!focusEntity) throw new Error('La entidad de foco no pertenece al proyecto.');
    const records = new Map<string, ContextEntityRecord>();
    for (const entity of entities.values()) {
      const record = this.repository.findEntityRecord(entity.id);
      if (record) records.set(entity.id, record);
    }
    const focus = records.get(focusEntity.id);
    if (!focus) throw new Error('No se pudieron cargar los detalles de la entidad seleccionada.');
    const ancestors = ancestorsOf(focus, records);
    const candidates: ContextCandidate[] = [];
    const conventions = this.projectRules(project, entities, candidates);
    this.notes(project.id, input.recentNotes ?? [], candidates);
    [focus, ...ancestors].forEach((record, i) =>
      candidates.push(
        candidateForRecord(
          record,
          i === 0 ? 'FOCUS_NODE' : 'HIERARCHY_PARENT',
          i,
          3,
          i === 0 ? Number.MAX_SAFE_INTEGER : 0,
        ),
      ),
    );
    const extraFocus = extraFocusOf(input, focus, records, candidates);
    // An execution's snapshot is pinned to the commit it starts from; a preview (no execution) reflects the user's HEAD.
    const repositoryCommit =
      input.sourceCommit ??
      (project.repositoryPath ? await this.files.getHeadCommit(project.repositoryPath) : 'UNKNOWN');
    return {
      project,
      focus,
      extraFocus,
      entities: records,
      relationships: this.repository.listRelationships(input.projectId),
      ancestors,
      constraints: [...project.rules, ...conventions],
      candidates,
      excluded: [],
      query: (
        input.query?.trim() ||
        [focus, ...extraFocus].map(record => `${record.entity.title} ${record.entity.summary}`).join(' ')
      ).trim(),
      maxHops: Math.max(0, Math.min(2, input.maxHops ?? 1)),
      repositoryCommit,
      ...(input.sourceCommit ? { sourceCommit: input.sourceCommit } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
    };
  }

  private policy(sourceId: string, entityKey: string, titleOrPath: string, content: string): ContextCandidate {
    return {
      sourceId,
      entityKey,
      sourceType: 'POLICY',
      titleOrPath,
      authorityTier: 1,
      retrievalOrigin: 'FOCUS_NODE',
      graphDistance: 0,
      content,
      contentHash: this.files.hashContent(content),
      relevanceScore: Number.MAX_SAFE_INTEGER,
    };
  }

  /** Tier 1, always included: the project profile, its rules and the conventions accepted tasks declared. */
  private projectRules(
    project: Project,
    entities: Map<string, { displayKey: string }>,
    candidates: ContextCandidate[],
  ) {
    // Goal, scope and stack of the project (inception profile): tier 1, a few lines in every run.
    const profile = renderProfileForContext(project);
    if (profile) candidates.push(this.policy(`profile:${project.id}`, 'PROFILE', 'Perfil del proyecto', profile));
    for (const [index, rule] of project.rules.entries()) {
      const content = rule.trim();
      if (content)
        candidates.push(
          this.policy(
            `policy:${project.id}:${index}`,
            `POLICY-${index + 1}`,
            `Regla del proyecto ${index + 1}`,
            content,
          ),
        );
    }
    // Conventions declared by accepted tasks are project rules from then on (tier 1, always included).
    const conventions: string[] = [];
    for (const outcome of this.repository.listTaskOutcomes(project.id)) {
      const key = entities.get(outcome.workItemId)?.displayKey ?? 'una tarea';
      for (const [index, rule] of extractConventions(outcome.summary).entries()) {
        if (conventions.includes(rule)) continue;
        conventions.push(rule);
        candidates.push(
          this.policy(
            `convention:${outcome.workItemId}:${index}`,
            `CONV-${key}-${index + 1}`,
            `Convención fijada por ${key}`,
            rule,
          ),
        );
      }
    }
    return conventions;
  }

  /** Recent chat notes: tier 6, only as search hints. */
  private notes(projectId: string, notes: string[], candidates: ContextCandidate[]): void {
    for (const [index, note] of notes.entries()) {
      const content = note.trim();
      if (!content) continue;
      candidates.push({
        sourceId: `chat:${projectId}:${index}`,
        sourceType: 'CHAT_NOTE',
        titleOrPath: `Nota conversacional ${index + 1}`,
        authorityTier: 6,
        retrievalOrigin: 'FULL_TEXT_SEARCH',
        graphDistance: 0,
        content,
        contentHash: this.files.hashContent(content),
        relevanceScore: 0,
      });
    }
  }
}

interface ResolveInput {
  projectId: string;
  focusEntityId: string;
  extraFocusEntityIds?: string[];
  query?: string;
  maxHops?: number;
  recentNotes?: string[];
  executionId?: string;
  sourceCommit?: string;
}
type Project = NonNullable<ReturnType<ContextRepositoryPort['findProjectContext']>>;

/** The focus's parents up to the root; a cycle or a missing parent is an error in the graph. */
function ancestorsOf(focus: ContextEntityRecord, records: Map<string, ContextEntityRecord>): ContextEntityRecord[] {
  const ancestors: ContextEntityRecord[] = [],
    visited = new Set([focus.entity.id]);
  let parentId = focus.entity.parentId;
  while (parentId) {
    if (visited.has(parentId)) throw new Error('La jerarquía del grafo contiene un ciclo.');
    visited.add(parentId);
    const parent = records.get(parentId);
    if (!parent) throw new Error('La jerarquía del foco contiene una entidad padre inexistente.');
    ancestors.push(parent);
    parentId = parent.entity.parentId;
  }
  return ancestors;
}

/** The other tasks of a grouped run count as focus too: always included, at the focus's tier. */
function extraFocusOf(
  input: ResolveInput,
  focus: ContextEntityRecord,
  records: Map<string, ContextEntityRecord>,
  candidates: ContextCandidate[],
): ContextEntityRecord[] {
  const extraFocus: ContextEntityRecord[] = [];
  for (const id of input.extraFocusEntityIds ?? []) {
    if (id === focus.entity.id || extraFocus.some(record => record.entity.id === id)) continue;
    const record = records.get(id);
    if (!record) throw new Error('Una de las tareas del grupo no pertenece al proyecto.');
    extraFocus.push(record);
    candidates.push(candidateForRecord(record, 'FOCUS_NODE', 0, 3, Number.MAX_SAFE_INTEGER));
  }
  return extraFocus;
}
export function candidateForRecord(
  record: import('./ports/context-engine-port.js').ContextEntityRecord,
  origin: ContextCandidate['retrievalOrigin'],
  distance: number,
  tier: ContextCandidate['authorityTier'],
  relevanceScore = 0,
  viaEdgeType?: ContextCandidate['viaEdgeType'],
): ContextCandidate {
  const { entity, attributes } = record;
  const path =
    typeof attributes.relative_path === 'string'
      ? attributes.relative_path
      : typeof attributes.file_path === 'string'
        ? attributes.file_path
        : undefined;
  const sourceType: ContextCandidate['sourceType'] =
    entity.entityType === 'DECISION_RECORD'
      ? 'ADR'
      : entity.entityType === 'REQUIREMENT'
        ? 'REQUIREMENT'
        : entity.entityType === 'WORK_ITEM'
          ? 'WORK_ITEM'
          : entity.entityType === 'CODE_REFERENCE'
            ? 'CODE_FILE'
            : entity.entityType === 'ARTIFACT' &&
                ['SPEC', 'IMPLEMENTATION_PLAN'].includes(String(attributes.artifact_type))
              ? 'SPECIFICATION'
              : 'DOC';
  const acceptedAttributes = Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) =>
        !['repository_id', 'content_hash', 'sync_status', 'entity_id', 'entityId'].includes(key) && value !== null,
    ),
  );
  const details = Object.keys(acceptedAttributes).length ? `\n${JSON.stringify(acceptedAttributes)}` : '';
  const content = record.bodyContent.trim() || `${entity.title}\n${entity.summary}${details}`;
  return {
    sourceId: entity.id,
    entityKey: entity.displayKey,
    sourceType,
    titleOrPath: path ?? entity.title,
    authorityTier: tier,
    retrievalOrigin: origin,
    ...(viaEdgeType ? { viaEdgeType } : {}),
    graphDistance: distance,
    content,
    contentHash: '',
    relevanceScore,
    record,
  };
}
