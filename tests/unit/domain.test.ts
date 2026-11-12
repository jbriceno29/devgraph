import { describe, expect, it } from 'vitest';
import { GraphTopologyService } from '@domain/graph/graph-topology-service.js';
import type { KnowledgeEntity, GraphRelationship } from '@domain/graph/knowledge-entity.js';
import { transitionWorkItem, canTransitionWorkItem, type WorkItem } from '@domain/work-management/entities.js';
import { transitionExecution, canTransitionExecution, type AgentExecution } from '@domain/agents/models.js';
import { DomainError } from '@shared/types/domain-error.js';
const base = (id: string, type: KnowledgeEntity['entityType']): KnowledgeEntity => ({
  id,
  projectId: 'p',
  entityType: type,
  displayKey: id,
  title: id,
  summary: '',
  status: 'DRAFT',
  parentId: null,
  createdRevision: 1,
  updatedRevision: 1,
  createdAt: 'now',
  updatedAt: 'now',
});
const edge = (id: string, sourceId: string, targetId: string): GraphRelationship => ({
  id,
  projectId: 'p',
  sourceId,
  targetId,
  edgeType: 'DEPENDS_ON',
  provenance: 'USER',
  createdRevision: 1,
  createdAt: 'now',
});
describe('GraphTopologyService', () => {
  const service = new GraphTopologyService();
  it('rejects incompatible edge types and self references', () => {
    expect(() => service.validateEdge(base('m', 'MODULE'), base('r', 'REQUIREMENT'), 'DEPENDS_ON', [])).toThrowError(
      DomainError,
    );
    expect(() => service.validateEdge(base('w', 'WORK_ITEM'), base('w', 'WORK_ITEM'), 'DEPENDS_ON', [])).toThrowError(
      /itself/,
    );
  });
  it('rejects DEPENDS_ON cycles', () => {
    expect(() =>
      service.validateEdge(base('b', 'WORK_ITEM'), base('a', 'WORK_ITEM'), 'DEPENDS_ON', [edge('ab', 'a', 'b')]),
    ).toThrowError(expect.objectContaining({ code: 'CYCLE_DETECTED' }));
    const supersedes: GraphRelationship = { ...edge('adr1', 'adr-a', 'adr-b'), edgeType: 'SUPERSEDES' };
    expect(() =>
      service.validateEdge(base('adr-b', 'DECISION_RECORD'), base('adr-a', 'DECISION_RECORD'), 'SUPERSEDES', [
        supersedes,
      ]),
    ).toThrowError(expect.objectContaining({ code: 'CYCLE_DETECTED' }));
  });
  it('accepts acyclic compatible dependencies', () => {
    expect(() => service.validateEdge(base('b', 'WORK_ITEM'), base('a', 'WORK_ITEM'), 'DEPENDS_ON', [])).not.toThrow();
  });
  it('rejects hierarchy cycles and invalid parents', () => {
    const a = { ...base('a', 'MODULE'), parentId: 'b' },
      b = { ...base('b', 'MODULE'), parentId: 'a' };
    expect(() => service.validateParent(a, b, [a, b])).toThrowError(/cycle/i);
    expect(() => service.validateParent(base('f', 'FEATURE'), base('r', 'PROJECT_ROOT'), [])).toThrowError(
      /cannot be placed/i,
    );
  });
});
describe('domain state machines', () => {
  it('enforces WorkItem transitions', () => {
    const item = {
      ...base('w', 'WORK_ITEM'),
      entityType: 'WORK_ITEM' as const,
      workType: 'TASK' as const,
      priority: 'MEDIUM' as const,
      scopeNotes: null,
      acceptanceCriteria: [],
      recommendedProfileRole: null,
    } as WorkItem;
    expect(canTransitionWorkItem('DRAFT', 'READY')).toBe(true);
    expect(transitionWorkItem(item, 'READY').status).toBe('READY');
    expect(() => transitionWorkItem(item, 'DONE')).toThrow(/Invalid WorkItem transition/);
  });
  it('enforces every AgentExecution status transition', () => {
    const execution: AgentExecution = {
      id: 'e',
      projectId: 'p',
      workItemId: null,
      profileId: 'pr',
      providerId: 'codex',
      sessionId: null,
      contextSnapshotId: null,
      status: 'QUEUED',
      modelUsed: null,
      initialCommit: 'abc',
      finalCommit: null,
      branchOrWorktree: null,
      baseBranch: null,
      testSummary: null,
      resultSummary: null,
      startedAt: null,
      completedAt: null,
    };
    expect(canTransitionExecution('QUEUED', 'PREPARING_CONTEXT')).toBe(true);
    expect(transitionExecution(execution, 'PREPARING_CONTEXT').status).toBe('PREPARING_CONTEXT');
    expect(() => transitionExecution(execution, 'COMPLETED')).toThrow(/Invalid AgentExecution transition/);
  });
});
