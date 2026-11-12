/**
 * Plan S5: a second model reviews a completed run against its acceptance criteria before the autopilot accepts it.
 * The checks the run passed are mostly tests its own agent wrote; the reviewer reads the diff without that bias.
 */
export interface ChangeReviewVerdict {
  approved: boolean;
  /** What is wrong or missing, one item per problem (empty when approved). */
  findings: string[];
  usage?: unknown;
}
export interface ChangeReviewPort {
  review(input: {
    projectId: string;
    executionId: string;
    model: string;
    signal?: AbortSignal;
  }): Promise<ChangeReviewVerdict>;
}
