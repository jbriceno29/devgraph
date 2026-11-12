import type { ActivityItemDto, ActivitySummaryDto } from '../../../shared/contracts/activity-view.js';
import type { InceptionActivityDto } from '../../../shared/contracts/inception-view.js';
import type { ActivitySourcePort } from './ports/activity-port.js';
import { addInceptionItem, pilotItems, proposalItems, taskItems } from './activity-items.js';

export const DEFAULT_ACTIVITY_LIMIT = 50;

/**
 * Activity inbox of a project, derived from data that already exists (no AI, no new tables): one entry per task by its
 * current state, plus pilot runs, agent plan proposals and pending approvals. Items that need the user come first.
 */
export class ActivityService {
  constructor(
    private readonly source: ActivitySourcePort,
    private readonly inception: (projectId: string) => InceptionActivityDto | null = () => null,
  ) {}

  list(projectId: string, limit = DEFAULT_ACTIVITY_LIMIT): ActivitySummaryDto {
    const max = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : DEFAULT_ACTIVITY_LIMIT;
    const data = this.source.snapshot(projectId, max);
    const keyOf = new Map(data.tasks.map(task => [task.id, task.displayKey]));
    const items: ActivityItemDto[] = [];
    const push: Parameters<typeof pilotItems>[1] = item =>
      items.push({ workItemId: null, executionId: null, featureId: null, changeSetId: null, ...item });
    taskItems(data, keyOf, items, push);
    pilotItems(data, push);
    proposalItems(data, keyOf, push);
    const inception = this.inception(projectId);
    addInceptionItem(inception, push);
    items.sort(
      (a, b) => Number(b.needsAttention) - Number(a.needsAttention) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0),
    );
    const running = data.tasks
      .filter(task => task.status === 'IN_PROGRESS')
      .map(task => ({ workItemKey: task.displayKey, title: task.title }));
    const inceptionItem = items.some(item => item.changeSetId && item.changeSetId === inception?.changeSetId);
    const integrations = (data.featureBranches ?? []).map(branch => ({
      featureId: branch.featureId,
      branchName: branch.branchName,
      targetBranch: branch.sourceBranch && branch.sourceBranch !== 'HEAD' ? branch.sourceBranch : null,
      integratedAt: branch.integratedAt,
    }));
    return {
      items: items.slice(0, max),
      running,
      attentionCount:
        items.filter(item => item.needsAttention).length + (inception?.needsAttention && !inceptionItem ? 1 : 0),
      ...(inception ? { inception } : {}),
      ...(integrations.length ? { integrations } : {}),
    };
  }
}
