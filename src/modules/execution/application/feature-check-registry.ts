import type { FeatureCheckRun } from './ports/feature-check-port.js';

export type FeatureCheckEntry =
  | { state: 'RUNNING'; commands: string[] }
  | { state: 'DONE'; commands: string[]; run: FeatureCheckRun; checkedAt: string };

/** The last integration check of each feature in this session (a restart asks to check again). */
export class FeatureCheckRegistry {
  private readonly entries = new Map<string, FeatureCheckEntry>();
  get(projectId: string, featureId: string): FeatureCheckEntry | undefined {
    return this.entries.get(`${projectId}:${featureId}`);
  }
  set(projectId: string, featureId: string, entry: FeatureCheckEntry): void {
    this.entries.set(`${projectId}:${featureId}`, entry);
  }
}
