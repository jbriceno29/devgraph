/**
 * Commits the Markdown documents the app writes, on the branch checked out in the user's repository,
 * so that every execution (which starts from Git) sees the same documents the graph references.
 */
export interface DocumentCommitPort {
  /** Paths among `paths` with uncommitted changes (modified, deleted or untracked). */
  uncommitted(repositoryRoot: string, paths: string[]): Promise<string[]>;
  /** Commits only `paths`. Never throws: a failed commit is reported, and execution start will refuse until it is fixed. */
  commit(
    repositoryRoot: string,
    paths: string[],
    message: string,
  ): Promise<{ committed: boolean; commit: string | null; error: string | null }>;
}
