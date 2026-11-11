import { DomainError } from '../../shared/types/domain-error.js';
export type GraphRevision = number & { readonly __brand: 'GraphRevision' };
export const graphRevision = (value: number): GraphRevision => {
  if (!Number.isSafeInteger(value) || value < 1) throw new DomainError('INVALID_GRAPH_REVISION', 'Graph revision must be a positive integer.');
  return value as GraphRevision;
};
export interface ProjectProps { id: string; name: string; slug: string; description?: string | null; objectives?: string[]; outOfScope?: string[]; techStack?: Record<string, unknown>; rules?: string[]; currentRevision?: number; createdAt: string; updatedAt: string }
export class Project {
  readonly currentRevision: GraphRevision;
  constructor(readonly props: ProjectProps) {
    if (!props.id || !props.name.trim() || !props.slug.trim()) throw new DomainError('INVALID_PROJECT', 'Project id, name, and slug are required.');
    this.currentRevision = graphRevision(props.currentRevision ?? 1);
  }
  advanceRevision(): Project { return new Project({ ...this.props, currentRevision: this.currentRevision + 1 }); }
}
