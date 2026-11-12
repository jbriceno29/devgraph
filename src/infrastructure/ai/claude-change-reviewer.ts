import { ClaudeChangeSetPlanner, type ClaudeChangeSetPlannerOptions } from './claude-change-set-planner.js';
import { CLAUDE_ISOLATION_ARGS } from './claude-code-adapter.js';
import { buildReviewPrompt, parseReview, reviewSchema, type ReviewInput } from './change-review-contract.js';
import type { ChangeReviewVerdict } from '../../application/ports/change-review-port.js';

/** Plan S5: the review is one `claude -p --json-schema` call, without tools, session or the user's settings. */
export class ClaudeChangeReviewer {
  private readonly runner: ClaudeChangeSetPlanner;
  constructor(cwd: string, options: ClaudeChangeSetPlannerOptions = {}) { this.runner = new ClaudeChangeSetPlanner(cwd, { timeoutMs: 300_000, ...options }); }
  async review(input: ReviewInput, model: string, signal?: AbortSignal): Promise<ChangeReviewVerdict> {
    const { output, usage } = await this.runner.structured(buildReviewPrompt(input), reviewSchema, model, CLAUDE_ISOLATION_ARGS, signal, { purpose: 'revisar el cambio' });
    return { ...parseReview(output, 'Claude Code'), usage };
  }
}
