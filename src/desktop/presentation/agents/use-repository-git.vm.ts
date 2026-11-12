import { useCallback, useEffect, useState } from 'react';
import type { RepositoryGitStatusDto } from '../../../shared/contracts/repository-git.js';
import { useUnsavedChanges } from '../../state/unsaved-changes.js';
import { repositoryGitApi } from './repository-git.api.js';

export interface RepositoryGitVm {
  status: RepositoryGitStatusDto | null;
  /** The base branch chosen in the selector (saved or not). */
  draft: string;
  setDraft(branch: string): void;
  dirty: boolean;
  busy: boolean;
  error: unknown;
  save(): Promise<void>;
  reload(): Promise<void>;
}

/** Reads the repository's git state, and changes the base branch (the change is a draft until saved). */
export function useRepositoryGit(projectId: string): RepositoryGitVm {
  const [status, setStatus] = useState<RepositoryGitStatusDto | null>(null),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const apply = (next: RepositoryGitStatusDto) => {
    setStatus(next);
    setDraft(next.baseBranch);
  };
  const reload = useCallback(async () => {
    setError(null);
    try {
      apply(await repositoryGitApi.status(projectId));
    } catch (reason) {
      setError(reason);
    }
  }, [projectId]);
  useEffect(() => {
    if (repositoryGitApi.available()) void reload();
  }, [reload]);
  const dirty = Boolean(status && draft && draft !== status.baseBranch);
  useUnsavedChanges('la rama base del repositorio', dirty);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await repositoryGitApi.setBaseBranch(projectId, draft));
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return { status, draft, setDraft, dirty, busy, error, save, reload };
}
