import { join } from 'node:path';
import type { DocumentCommitPort } from '../../application/ports/document-commit-port.js';
import { git } from './git-isolation-service.js';

/** Commits app-written documents with pathspec-limited commits: anything else the user has staged is left alone. */
export class GitDocumentCommitter implements DocumentCommitPort {
  async uncommitted(repositoryRoot: string, paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const status = await run(repositoryRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      ...paths,
    ]);
    // -z records are "XY path\0"; renames add the old path as an extra record, which we skip.
    const records = status.split('\0').filter(Boolean);
    const dirty: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      dirty.push(record.slice(3));
      if (record[0] === 'R' || record[0] === 'C') index += 1;
    }
    return [...new Set(dirty)].sort();
  }

  async commit(
    repositoryRoot: string,
    paths: string[],
    message: string,
  ): Promise<{ committed: boolean; commit: string | null; error: string | null }> {
    if (!paths.length) return { committed: false, commit: null, error: null };
    try {
      await run(repositoryRoot, ['add', '--', ...paths]);
      const staged = await run(repositoryRoot, ['diff', '--cached', '--quiet', '--', ...paths]).then(
        () => false,
        () => true,
      );
      if (staged) {
        const hasIdentity = await run(repositoryRoot, ['config', 'user.email']).then(
          value => Boolean(value.trim()),
          () => false,
        );
        await run(repositoryRoot, [
          ...(hasIdentity ? [] : ['-c', 'user.name=Graph Workspace', '-c', 'user.email=graph-workspace@localhost']),
          'commit',
          '--no-verify',
          '--quiet',
          '-m',
          message,
          '--',
          ...paths,
        ]);
      }
      return { committed: staged, commit: (await run(repositoryRoot, ['rev-parse', 'HEAD'])).trim(), error: null };
    } catch (error) {
      return { committed: false, commit: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Literal pathspecs and no repository hooks: these commits only ever contain the given documents. */
function run(repositoryRoot: string, args: string[]): Promise<string> {
  return git(repositoryRoot, [
    '--literal-pathspecs',
    '-c',
    'core.fsmonitor=false',
    '-c',
    `core.hooksPath=${join(repositoryRoot, '.git', 'graphdev-no-hooks')}`,
    ...args,
  ]);
}
