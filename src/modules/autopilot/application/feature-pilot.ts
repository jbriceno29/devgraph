import type { AgentOrchestrator, ChangeReviewPort } from '../../execution/index.js';
import type { FeatureAutonomy, PilotRun, PilotStatus } from '../domain/models.js';
import { autoAccept } from './pilot-acceptance.js';
import { reconcile, resume, setAutonomy, shutdown, start, status, stop } from './pilot-control.js';
import type { PilotKernel } from './pilot-kernel.js';
import type { PilotRepositoryPort } from './ports/pilot-port.js';

/**
 * Autonomy per feature (Stage 3).
 * - AUTO_ACCEPT: a completed run of the feature is integrated on its own when the gates pass.
 * - PILOT: also picks and launches the next READY task, retries failures with their context, pauses near the usage
 *   limit, and stops to ask the user — with the reason — whenever a human decision is needed.
 * Gates for accepting without a human: the run COMPLETED (audit passed) and at least one verification command ran and
 * passed. Without configured checks nothing is accepted automatically.
 *
 * A facade (A3): control in `pilot-control.ts`, the loop in `pilot-loop.ts`, acceptance in `pilot-acceptance.ts`, all
 * on the shared `PilotKernel`.
 */
export class FeaturePilot {
  private readonly k: PilotKernel;

  constructor(
    orchestrator: AgentOrchestrator,
    repository: PilotRepositoryPort,
    emit: PilotKernel['emit'] = () => undefined,
    options: { pollMs?: number } = {},
    /** Plan S5: reviews runs of features with a review model before the pilot accepts them. */
    reviewer: ChangeReviewPort | null = null,
  ) {
    this.k = { orchestrator, repository, emit, options, reviewer, loops: new Map(), resumeTimers: new Map() };
    orchestrator.onExecutionFinished(execution => {
      void autoAccept(this.k, execution);
    });
  }

  getAutonomy(projectId: string, featureId: string): FeatureAutonomy {
    return this.k.repository.getAutonomy(projectId, featureId);
  }
  setAutonomy(projectId: string, featureId: string, input: Parameters<typeof setAutonomy>[3]): FeatureAutonomy {
    return setAutonomy(this.k, projectId, featureId, input);
  }
  status(projectId: string, featureId: string) {
    return status(this.k, projectId, featureId);
  }
  /** Starts the autopilot. `acknowledgeCost` must be true: the UI shows the cost warning before calling this. */
  start(projectId: string, featureId: string, input: { acknowledgeCost: boolean }): PilotRun {
    return start(this.k, projectId, featureId, input);
  }
  stop(projectId: string, featureId: string, reason?: string): Promise<PilotRun | null> {
    return stop(this.k, projectId, featureId, reason);
  }
  /** Continues a paused or waiting autopilot (for example after the user fixed what it asked for). */
  resume(projectId: string, featureId: string): PilotRun {
    return resume(this.k, projectId, featureId);
  }
  /** Runs left RUNNING by a process that died cannot continue: mark them stopped. */
  reconcile(projectId: string): void {
    reconcile(this.k, projectId);
  }
  shutdown(): void {
    shutdown(this.k);
  }
}

export type { PilotStatus };
