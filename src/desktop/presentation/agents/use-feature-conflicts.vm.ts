import { useCallback, useEffect, useState } from 'react';
import type { FeatureIntegrationStateDto } from '../../../shared/contracts/agent-view.js';
import type {
  FeatureConflictsDto,
  ResolveFeatureConflictsResultDto,
} from '../../../shared/contracts/feature-conflicts.js';
import { featureConflictsApi } from './feature-conflicts.api.js';

export interface FeatureConflictsVm {
  conflicts: FeatureConflictsDto | null;
  /** Integrating now would fail (or a resolution is not finished): the «Integrar» button is hidden. */
  blocksIntegration: boolean;
  resolving: boolean;
  resolved: ResolveFeatureConflictsResultDto | null;
  error: unknown;
  resolve(): Promise<void>;
}

/**
 * Checks a finished, not yet integrated feature for conflicts (with its base branch and with other features) and runs
 * «Resolver con un agente». Without the ids (older core) or the command, it reports nothing and blocks nothing.
 */
export function useFeatureConflicts(state: FeatureIntegrationStateDto | null | undefined): FeatureConflictsVm {
  const projectId = state?.projectId ?? '',
    featureId = state?.featureId ?? '';
  const finished = Boolean(state && state.taskCount > 0 && state.openTaskCount === 0 && !state.integratedAt);
  const enabled = finished && Boolean(projectId && featureId) && featureConflictsApi.available();
  const [conflicts, setConflicts] = useState<FeatureConflictsDto | null>(null),
    [resolving, setResolving] = useState(false),
    [resolved, setResolved] = useState<ResolveFeatureConflictsResultDto | null>(null),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setConflicts(null);
    setResolved(null);
    setError(null);
    if (!enabled) return;
    let current = true;
    featureConflictsApi.check(projectId, featureId).then(
      found => current && setConflicts(found),
      // Without the check the panel behaves as before: integrating reports the conflict if there is one.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [enabled, projectId, featureId]);
  const resolve = useCallback(async () => {
    setResolving(true);
    setError(null);
    try {
      setResolved(await featureConflictsApi.resolve(projectId, featureId));
    } catch (reason) {
      setError(reason);
    } finally {
      setResolving(false);
    }
  }, [projectId, featureId]);
  const blocking = Boolean(conflicts && (conflicts.withTarget.length || conflicts.unresolved.length));
  return { conflicts, blocksIntegration: blocking || Boolean(resolved), resolving, resolved, error, resolve };
}
