/** What an accepted task left behind: the agent's closing summary and the evidence of the integrated change. */
export interface TaskOutcome {
  workItemId: string;
  projectId: string;
  executionId: string;
  /** The agent's final message: what it did, decisions taken and what is left pending. */
  summary: string;
  files: Array<{ path: string; status: 'ADDED'|'MODIFIED'|'DELETED'|'RENAMED' }>;
  checks: Array<{ command: string; passed: boolean }>;
  mergedCommit: string | null;
  integrationBranch: string | null;
  createdAt: string;
}
