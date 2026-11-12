import { useCallback, useEffect, useState } from 'react';
import type { FeatureIntegrationStateDto } from '../../../shared/contracts/agent-view.js';
import type { FeatureChecksDto } from '../../../shared/contracts/feature-checks.js';
import { featureChecksApi } from './feature-checks.api.js';

/** While the checks run (a build takes minutes) the panel asks again every few seconds. */
export const CHECKS_POLL_MS = 3_000;

export interface FeatureChecksVm {
  checks: FeatureChecksDto | null;
  /** «Integrar» waits until the checks passed on the current branches. */
  blocksIntegration: boolean;
  starting: boolean;
  error: unknown;
  run(): Promise<void>;
}

/** The integration checks of a finished feature (plan C6). Without the ids or the command, it blocks nothing. */
export function useFeatureChecks(state: FeatureIntegrationStateDto | null | undefined): FeatureChecksVm {
  const projectId = state?.projectId ?? '',
    featureId = state?.featureId ?? '';
  const finished = Boolean(state && state.taskCount > 0 && state.openTaskCount === 0);
  const enabled = finished && Boolean(projectId && featureId) && featureChecksApi.available();
  const [checks, setChecks] = useState<FeatureChecksDto | null>(null),
    [starting, setStarting] = useState(false),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setChecks(null);
    setError(null);
    if (!enabled) return;
    let current = true;
    featureChecksApi.get(projectId, featureId).then(
      found => current && setChecks(found),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [enabled, projectId, featureId]);
  const running = checks?.status === 'RUNNING';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      featureChecksApi.get(projectId, featureId).then(setChecks, setError);
    }, CHECKS_POLL_MS);
    return () => clearInterval(timer);
  }, [running, projectId, featureId]);
  const run = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      setChecks(await featureChecksApi.run(projectId, featureId));
    } catch (reason) {
      setError(reason);
    } finally {
      setStarting(false);
    }
  }, [projectId, featureId]);
  const blocksIntegration = Boolean(checks && checks.status !== 'NONE' && checks.status !== 'PASSED');
  return { checks, blocksIntegration, starting, error, run };
}
