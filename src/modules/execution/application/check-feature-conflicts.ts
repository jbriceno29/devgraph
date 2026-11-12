import type { FeatureConflictsDto } from '../../../shared/contracts/feature-conflicts.js';
import type { FeatureCatalogPort, FeatureConflictGitPort } from './ports/feature-conflict-port.js';

/**
 * Where a feature collides before it is integrated: with its target branch (integrating would fail), with other features
 * not integrated yet (whichever goes second will collide) and markers a resolution left behind. Read-only.
 */
export class CheckFeatureConflicts {
  constructor(
    private readonly git: FeatureConflictGitPort,
    private readonly catalog: FeatureCatalogPort,
  ) {}

  async execute(projectId: string, featureId: string): Promise<FeatureConflictsDto> {
    const repositoryRoot = this.catalog.repositoryRoot(projectId);
    const own = this.catalog.integration(projectId, featureId);
    const target = own?.targetBranch ?? null;
    const result: FeatureConflictsDto = {
      featureId,
      targetBranch: target,
      withTarget: [],
      withFeatures: [],
      unresolved: [],
    };
    if (!repositoryRoot || !own) return result;
    // A branch that is gone (or a git failure) gives no information, never a false conflict.
    const safely = (read: Promise<string[]>) => read.catch(() => [] as string[]);
    if (target) {
      result.withTarget = await safely(this.git.conflicts(repositoryRoot, target, own.branchName));
      result.unresolved = await safely(this.git.filesWithMarkers(repositoryRoot, own.branchName, target));
    }
    for (const other of this.catalog.features(projectId)) {
      if (other.id === featureId) continue;
      const branch = this.catalog.integration(projectId, other.id);
      if (!branch || branch.integratedAt) continue;
      const files = await safely(this.git.conflicts(repositoryRoot, branch.branchName, own.branchName));
      if (files.length)
        result.withFeatures.push({ featureId: other.id, featureKey: other.displayKey, title: other.title, files });
    }
    return result;
  }
}
