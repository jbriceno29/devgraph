/**
 * Commits the Markdown documents the app writes on the project's base branch, in the user's checkout, so that every
 * execution (which starts from Git) sees the same documents the graph references. The app only writes there when the
 * checkout is on the base branch with no git operation half done (plan GIT, G3 and G7).
 */
export interface DocumentCommitPort {
  /** Why the app must not write documents in this checkout now (in Spanish, with the way out); null when it can. */
  blocker(repositoryRoot: string): Promise<string | null>;
  /** Paths among `paths` with uncommitted changes (modified, deleted or untracked). Throws the blocker, if any. */
  uncommitted(repositoryRoot: string, paths: string[]): Promise<string[]>;
  /** Commits only `paths`. Never throws: a failed commit is reported, and execution start will refuse until it is fixed. */
  commit(
    repositoryRoot: string,
    paths: string[],
    message: string,
  ): Promise<{ committed: boolean; commit: string | null; error: string | null }>;
}
