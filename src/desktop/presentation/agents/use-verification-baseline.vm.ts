import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerificationBaselineDto } from '../../../shared/contracts/verification-baseline.js';
import { verificationBaselineApi } from './verification-baseline.api.js';
import { baselineOutdated, failingOf } from './verification-baseline.logic.js';

export const BASELINE_POLL_MS = 3_000;

export interface VerificationBaselineVm {
  baseline: VerificationBaselineDto | null;
  /** The checks on screen differ from the ones the baseline ran. */
  outdated: boolean;
  busy: boolean;
  error: unknown;
  run(): Promise<void>;
  acceptKnown(): Promise<void>;
  clearKnown(): Promise<void>;
}

/**
 * Plan REP, R2. `commands`: the checks on screen (the inception's edit); absent, the project's policy. With `autoRun`
 * it starts by itself the first time, so the result is there before the proposal.
 */
export function useVerificationBaseline(
  projectId: string,
  options: { commands?: string[]; autoRun?: boolean } = {},
): VerificationBaselineVm {
  const [baseline, setBaseline] = useState<VerificationBaselineDto | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const started = useRef(false);
  const { commands, autoRun } = options;
  const act = useCallback(async (call: () => Promise<VerificationBaselineDto>) => {
    setBusy(true);
    setError(null);
    try {
      setBaseline(await call());
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }, []);
  const run = useCallback(
    () => act(() => verificationBaselineApi.run(projectId, commands)),
    [act, projectId, commands],
  );
  useEffect(() => {
    if (!verificationBaselineApi.available()) return;
    let current = true;
    verificationBaselineApi.get(projectId).then(found => {
      if (!current) return;
      setBaseline(found);
      const runnable = commands ? commands.length > 0 : found.commands.length > 0;
      if (autoRun && !started.current && found.status === 'NOT_RUN' && runnable) {
        started.current = true;
        void run();
      }
    }, setError);
    return () => {
      current = false;
    };
    // Only on open: later edits of the checks show «Volver a comprobar» instead of running again on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  usePollWhileRunning(projectId, baseline?.status === 'RUNNING', setBaseline, setError);
  return {
    baseline,
    outdated: baselineOutdated(baseline, commands),
    busy,
    error,
    run,
    acceptKnown: () => act(() => verificationBaselineApi.acceptKnown(projectId, baseline ? failingOf(baseline) : [])),
    clearKnown: () => act(() => verificationBaselineApi.acceptKnown(projectId, [])),
  };
}

/** While the baseline runs, asks for it again every few seconds. */
function usePollWhileRunning(
  projectId: string,
  running: boolean,
  onResult: (baseline: VerificationBaselineDto) => void,
  onError: (error: unknown) => void,
) {
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => verificationBaselineApi.get(projectId).then(onResult, onError), BASELINE_POLL_MS);
    return () => clearInterval(timer);
  }, [running, projectId, onResult, onError]);
}
