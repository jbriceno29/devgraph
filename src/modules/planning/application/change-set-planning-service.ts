import type { ProjectRepositoryPort } from '../../projects/index.js';
import type { KnowledgeGraphRepositoryPort } from '../../knowledge/index.js';
import type {
  ChangeSetApplyPort,
  ChangeSetPlannerPort,
  ChangeSetRepositoryPort,
  PlanningReference,
  PlanningUiSpec,
} from './ports/change-set-planning-port.js';
import { applyUiSpecPlan } from './ui-spec-update.js';
import type { ChangeSet, ChangeOperation } from '../../knowledge/index.js';
import { ChangeSetValidator } from './changeset-validator.js';
import { withCatalogProfile } from './stack-change.js';

export class ChangeSetPlanningService {
  private readonly validator = new ChangeSetValidator();
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly graph: KnowledgeGraphRepositoryPort,
    private readonly changes: ChangeSetRepositoryPort,
    private readonly planner: ChangeSetPlannerPort,
    private readonly applier: ChangeSetApplyPort,
    private readonly repositoryPath: (projectId: string) => string | null,
  ) {}
  /**
   * Asks the planner for a ChangeSet. `extras` (planning a feature on a project in progress): translated `references` go to the prompt as data, and `uiSpec`
   * says whether docs/UI_SPEC.md exists and whether the user wants it updated; new features are linked to it and a proposal that should update it and does
   * not cannot be applied (the validator also refuses one that drops any of its sections).
   */
  async propose(
    projectId: string,
    prompt: string,
    focusEntityId?: string,
    contextPackage?: string,
    model?: string,
    extras: { references?: PlanningReference[]; uiSpec?: PlanningUiSpec } = {},
  ): Promise<ChangeSet> {
    const project = this.projects.findById(projectId);
    if (!project) throw new Error('Proyecto no encontrado.');
    if (!prompt.trim()) throw new Error('Escribe qué cambios quieres proponer.');
    const entities = this.graph.listEntities(projectId),
      draft = await this.planner.propose({
        prompt: prompt.trim(),
        ...(contextPackage ? { contextPackage } : {}),
        ...(model ? { model } : {}),
        project: {
          name: project.props.name,
          description: project.props.description ?? null,
          rules: project.props.rules ?? [],
          revision: project.currentRevision,
          ...(project.props.objectives?.length ? { objectives: project.props.objectives } : {}),
          ...(project.props.techStack && Object.keys(project.props.techStack).length
            ? { techStack: project.props.techStack }
            : {}),
        },
        focusEntity: entities.find(e => e.id === focusEntityId) ?? null,
        entities,
        relationships: this.graph.listRelationships(projectId),
        ...(extras.references?.length ? { references: extras.references } : {}),
        ...(extras.uiSpec ? { uiSpec: extras.uiSpec } : {}),
      });
    const relationships = this.graph.listRelationships(projectId),
      features = new Set(entities.filter(entity => entity.entityType === 'FEATURE').map(entity => entity.id));
    const linked = new Set(
      extras.uiSpec?.entityId
        ? relationships
            .filter(edge => edge.edgeType === 'DOCUMENTED_BY' && edge.targetId === extras.uiSpec!.entityId)
            .map(edge => edge.sourceId)
        : [],
    );
    const plan = extras.uiSpec
      ? applyUiSpecPlan(draft.operations, extras.uiSpec, { features, linked })
      : { operations: draft.operations, problems: [] };
    const used = extras.references?.length
      ? `\n\nReferencias usadas: ${extras.references.map(item => `«${item.name}» (${item.kind === 'VISUAL' ? 'cómo debe verse' : item.kind === 'FUNCTIONAL' ? 'qué debe hacer' : 'solo inspiración'})`).join(', ')}.`
      : '';
    const changeSet: ChangeSet = {
      id: globalThis.crypto.randomUUID(),
      projectId,
      baseGraphRevision: project.currentRevision,
      originType: 'AI_CHAT',
      title: draft.title,
      rationale: `${draft.rationale}${used}`,
      status: 'PENDING_APPROVAL',
      operations: plan.operations.map(withCatalogProfile),
      validationIssues: [],
      createdAt: new Date().toISOString(),
    };
    const validation = this.validator.validate(
      changeSet,
      project.currentRevision,
      entities,
      this.graph.listRelationships(projectId),
    );
    const issues = [
      ...validation.issues,
      ...plan.problems.map(message => ({
        operationIndex: -1,
        severity: 'ERROR' as const,
        code: 'UI_SPEC_MISSING',
        message,
      })),
    ];
    const result = {
      ...changeSet,
      status:
        validation.status === 'VALIDATED' && plan.problems.length ? ('PENDING_APPROVAL' as const) : validation.status,
      validationIssues: issues,
    };
    this.changes.save(result);
    return result;
  }
  /** Stores a plan change proposed by an agent when it closed a task, validated against the current graph; never applies it. */
  submit(
    projectId: string,
    draft: { title: string; rationale: string; operations: ChangeOperation[] },
    originRefId: string,
    originType: ChangeSet['originType'] = 'AGENT_EXECUTION',
  ): ChangeSet {
    const project = this.projects.findById(projectId);
    if (!project) throw new Error('Proyecto no encontrado.');
    const changeSet: ChangeSet = {
      id: globalThis.crypto.randomUUID(),
      projectId,
      baseGraphRevision: project.currentRevision,
      originType,
      originRefId,
      title: draft.title,
      rationale: draft.rationale,
      status: 'PENDING_APPROVAL',
      operations: draft.operations.map(withCatalogProfile),
      validationIssues: [],
      createdAt: new Date().toISOString(),
    };
    const validation = this.validator.validate(
      changeSet,
      project.currentRevision,
      this.graph.listEntities(projectId),
      this.graph.listRelationships(projectId),
    );
    const result = { ...changeSet, status: validation.status, validationIssues: validation.issues };
    this.changes.save(result);
    return result;
  }
  edit(id: string, operations: ChangeOperation[]): ChangeSet {
    const current = this.requireChangeSet(id);
    if (!['PENDING_APPROVAL', 'CONFLICTED', 'VALIDATED'].includes(current.status))
      throw new Error('Esta propuesta ya no se puede editar.');
    const project = this.projects.findById(current.projectId)!;
    const edited = {
      ...current,
      baseGraphRevision: project.currentRevision,
      operations,
      status: 'PENDING_APPROVAL' as const,
      validationIssues: [],
    };
    const validation = this.validator.validate(
      edited,
      project.currentRevision,
      this.graph.listEntities(current.projectId),
      this.graph.listRelationships(current.projectId),
    );
    const result = { ...edited, status: validation.status, validationIssues: validation.issues };
    this.changes.save(result);
    return result;
  }
  /** Open proposals are revalidated on read: a rule fixed after one was stored no longer blocks it (and a new one shows up). */
  list(projectId: string): ChangeSet[] {
    return this.changes.list(projectId).map(changeSet => this.refresh(changeSet));
  }
  find(id: string): ChangeSet | null {
    const found = this.changes.findById(id);
    return found ? this.refresh(found) : null;
  }
  reject(id: string): ChangeSet {
    const current = this.requireChangeSet(id);
    if (['APPLIED', 'REJECTED'].includes(current.status)) throw new Error('La propuesta ya está cerrada.');
    const result = { ...current, status: 'REJECTED' as const };
    this.changes.save(result);
    return result;
  }
  async apply(id: string): Promise<{ changeSet: ChangeSet; revision: number; resolvedIds: Record<string, string> }> {
    const stored = this.requireChangeSet(id);
    const project = this.projects.findById(stored.projectId);
    if (!project) throw new Error('Proyecto no encontrado.');
    // Checked against the graph as it is now: a stale base revision or a new issue stops it here.
    const current = this.refresh(stored, project.currentRevision);
    if (current.status === 'CONFLICTED' || (stored.status === 'VALIDATED' && current.status !== 'VALIDATED'))
      throw new Error('La propuesta entró en conflicto y debe revisarse.');
    if (current.status !== 'VALIDATED') throw new Error('Valida la propuesta antes de aplicarla.');
    let applied: { revision: number; resolvedIds: Record<string, string> };
    try {
      applied = await this.applier.apply(current, this.repositoryPath(current.projectId));
    } catch (error) {
      if (error instanceof Error && error.message.includes('REVISION_CONFLICT')) {
        const conflicted = {
          ...current,
          status: 'CONFLICTED' as const,
          validationIssues: [
            {
              operationIndex: -1,
              severity: 'ERROR' as const,
              code: 'REVISION_CONFLICT',
              message: 'El grafo cambió mientras se aplicaba la propuesta. Vuelve a generarla o edítala.',
            },
          ],
        };
        this.changes.save(conflicted);
      }
      throw error;
    }
    const result = {
      ...current,
      status: 'APPLIED' as const,
      appliedGraphRevision: applied.revision,
      appliedAt: new Date().toISOString(),
    };
    this.changes.save(result);
    return { changeSet: result, revision: applied.revision, resolvedIds: applied.resolvedIds };
  }
  /**
   * Validates an open proposal again against the current graph and rules, keeping the UI spec problems found when it was
   * planned; saves it only when the result changed. On read (`currentRevision` omitted) only the rules are checked: a
   * graph that moved on is a conflict when the proposal is applied, as before, and a conflicted one waits for an edit.
   */
  private refresh(changeSet: ChangeSet, currentRevision?: number): ChangeSet {
    const open: ChangeSet['status'][] =
      currentRevision === undefined
        ? ['PENDING_APPROVAL', 'VALIDATED']
        : ['PENDING_APPROVAL', 'VALIDATED', 'CONFLICTED'];
    if (!open.includes(changeSet.status)) return changeSet;
    const kept = changeSet.validationIssues.filter(issue => issue.code === 'UI_SPEC_MISSING');
    const validation = this.validator.validate(
      changeSet,
      currentRevision ?? changeSet.baseGraphRevision,
      this.graph.listEntities(changeSet.projectId),
      this.graph.listRelationships(changeSet.projectId),
    );
    const issues = [...validation.issues, ...kept];
    const status = validation.status === 'VALIDATED' && kept.length ? ('PENDING_APPROVAL' as const) : validation.status;
    if (status === changeSet.status && JSON.stringify(issues) === JSON.stringify(changeSet.validationIssues))
      return changeSet;
    const result = { ...changeSet, status, validationIssues: issues };
    this.changes.save(result);
    return result;
  }
  private requireChangeSet(id: string): ChangeSet {
    const found = this.changes.findById(id);
    if (!found) throw new Error('Propuesta no encontrada.');
    return found;
  }
}
