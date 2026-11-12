import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FeatureMetrics, renderFeatureReport } from '../../modules/autopilot/application/feature-metrics.js';
import { FeaturePilot } from '../../modules/autopilot/application/feature-pilot.js';
import { SqlitePilotRepository } from '../../modules/autopilot/infrastructure/sqlite-pilot-repository.js';
import { coveredWorkItems } from '../../modules/execution/domain/models.js';
import type { ChangeReviewPort } from '../../modules/execution/application/ports/change-review-port.js';
import type { ReviewInput } from '../../modules/execution/infrastructure/change-review-contract.js';
import { ClaudeChangeReviewer } from '../../modules/execution/infrastructure/claude-change-reviewer.js';
import { SqliteReviewEvidence } from '../../modules/execution/infrastructure/sqlite-review-evidence.js';
import type { Container } from '../container.js';

/** One autopilot per project, sharing that project's orchestrator, and the per-feature metrics. */
export function autopilotServices(c: Container) {
  const pilots = new Map<string, FeaturePilot>();
  return {
    pilot: (projectId: string) => {
      const cached = pilots.get(projectId);
      if (cached) return cached;
      const pilot = new FeaturePilot(
        c.execution(projectId),
        new SqlitePilotRepository(c.store.openProject(projectId).database),
        (channel, payload) => c.emit(channel, payload),
        {},
        reviewer(c, projectId),
      );
      pilots.set(projectId, pilot);
      return pilot;
    },
    featureReport: (projectId: string, featureId: string) => {
      const workspace = c.store.openProject(projectId);
      const feature = workspace.graph.findEntityById(featureId);
      if (!feature || feature.projectId !== projectId || feature.entityType !== 'FEATURE')
        throw new Error('Feature no encontrada en este proyecto.');
      const report = new FeatureMetrics(c.execution(projectId), new SqlitePilotRepository(workspace.database)).report(
        projectId,
        featureId,
      );
      return { report, markdown: renderFeatureReport(report, `${feature.displayKey} ${feature.title}`) };
    },
    close: () => {
      for (const pilot of pilots.values()) pilot.shutdown();
    },
  };
}

/** Plan S5: the review gathers its evidence (tasks and criteria, project rules, diff, checks) and asks the review engine. */
function reviewer(c: Container, projectId: string): ChangeReviewPort | null {
  if (!c.dependencies.changeReviewer && c.agentAdapter.providerId !== 'claude-code') return null;
  return {
    review: async input => {
      const detail = c.execution(projectId).detail(input.executionId),
        execution = detail.execution;
      const evidenceRows = new SqliteReviewEvidence(c.store.openProject(projectId).database);
      const logPath = join(c.workspaceRoot, 'projects', projectId, 'executions', execution.id, 'test-output.log');
      const evidence: ReviewInput = {
        tasks: evidenceRows.tasks(coveredWorkItems(execution)),
        rules: evidenceRows.rules(projectId),
        files: detail.files.map(file => ({ path: file.path, changeType: file.changeType, patch: file.patch })),
        checks: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '',
      };
      if (c.dependencies.changeReviewer) return c.dependencies.changeReviewer.review(evidence, input.model);
      return new ClaudeChangeReviewer(c.workspaceRoot, { authMode: c.connection(projectId).authMode }).review(
        evidence,
        input.model,
        input.signal,
      );
    },
  };
}
