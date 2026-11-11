import type { FeatureAutonomy, PilotEvent, PilotEventKind, PilotRun, PilotStatus } from '../../domain/autonomy/models.js';

export interface FeatureTaskView { id: string; displayKey: string; title: string; status: string; dependsOn: string[] }

export interface PilotRepositoryPort {
  getAutonomy(projectId: string, featureId: string): FeatureAutonomy;
  saveAutonomy(autonomy: FeatureAutonomy): void;
  /** Feature of a work item (nearest FEATURE ancestor), or null. */
  featureOf(projectId: string, workItemId: string): string | null;
  /** Work items under a feature (direct children and their subtasks) with their DEPENDS_ON targets. */
  listFeatureTasks(projectId: string, featureId: string): FeatureTaskView[];
  createRun(run: PilotRun): void;
  updateRun(runId: string, status: PilotStatus, reason: string | null, endedAt: string | null): void;
  findRun(runId: string): PilotRun | null;
  latestRun(featureId: string): PilotRun | null;
  listRuns(projectId: string, statuses: PilotStatus[]): PilotRun[];
  appendEvent(runId: string, kind: PilotEventKind, message: string, workItemId: string | null, executionId: string | null): PilotEvent;
  listEvents(runId: string, limit: number): PilotEvent[];
}
