import type { AgentExecution } from './models.js';

/** The packages a failed run needs approved (plan S2), or null when it failed for another reason. */
export function unapprovedPackages(execution: AgentExecution): string[] | null {
  const summary = execution.testSummary as { reason?: unknown; packages?: unknown } | null;
  return summary?.reason === 'DEPENDENCY_APPROVAL' && Array.isArray(summary.packages)
    ? summary.packages.map(String)
    : null;
}

/** Plan S5: what a completed run may have done to its own verification (deleted or skipped tests, verification config). */
export function executionQualityFlags(execution: AgentExecution): string[] {
  const flags = (execution.testSummary as { qualityFlags?: unknown } | null)?.qualityFlags;
  return Array.isArray(flags) ? flags.map(String) : [];
}
