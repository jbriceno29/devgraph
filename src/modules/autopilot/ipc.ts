import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SetFeatureAutonomyInput } from '../../shared/contracts/agent-view.js';
import { text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { FeaturePilot } from './application/feature-pilot.js';

export interface AutopilotIpcDeps {
  workspaceRoot: string;
  pilot(projectId: string): FeaturePilot;
  featureReport(projectId: string, featureId: string): { report: unknown; markdown: string };
}

/** The autopilot of each feature and its metrics report. */
export function autopilotHandlers(d: AutopilotIpcDeps): IpcHandlers {
  const of = (projectId: unknown) => d.pilot(text(projectId));
  return {
    'pilot:set_autonomy': ([id, featureId, input]) =>
      of(id).setAutonomy(text(id), text(featureId), input as SetFeatureAutonomyInput),
    'pilot:start': ([id, featureId, input]) =>
      of(id).start(text(id), text(featureId), {
        acknowledgeCost: Boolean((input as { acknowledgeCost?: boolean } | undefined)?.acknowledgeCost),
      }),
    'pilot:stop': ([id, featureId]) => of(id).stop(text(id), text(featureId)),
    'pilot:resume': ([id, featureId]) => of(id).resume(text(id), text(featureId)),
    'metrics:feature_report': ([id, featureId]) => d.featureReport(text(id), text(featureId)),
    'metrics:export_report': ([id, featureId]) => {
      const projectId = text(id);
      const { markdown } = d.featureReport(projectId, text(featureId));
      if (!/^[a-f0-9-]{36}$/i.test(projectId)) throw new Error('Proyecto inválido.');
      const directory = join(d.workspaceRoot, 'projects', projectId, 'reports');
      mkdirSync(directory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = join(directory, `feature-${text(featureId).replace(/[^a-zA-Z0-9-]/g, '')}-${stamp}.md`);
      writeFileSync(path, markdown, 'utf8');
      return { path };
    },
  };
}
