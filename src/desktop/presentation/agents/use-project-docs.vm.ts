import { useCallback, useEffect, useState } from 'react';
import type { ProjectDocsDto } from '../../../shared/contracts/project-docs.js';
import { useUnsavedChanges } from '../../state/unsaved-changes.js';
import { projectDocsApi } from './project-docs.api.js';
import { domainLines } from './project-docs.logic.js';

export interface ProjectDocsVm {
  docs: ProjectDocsDto | null;
  /** Draft of the switch and of the user's domains (one per line), until saved. */
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  extraText: string;
  setExtraText(text: string): void;
  dirty: boolean;
  busy: boolean;
  error: unknown;
  save(): Promise<void>;
  cancel(): void;
}

/** Reads and edits whether the project's agents read documentation and from which extra domains. */
export function useProjectDocs(projectId: string): ProjectDocsVm {
  const [docs, setDocs] = useState<ProjectDocsDto | null>(null),
    [enabled, setEnabled] = useState(true),
    [extraText, setExtraText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const apply = useCallback((next: ProjectDocsDto) => {
    setDocs(next);
    setEnabled(next.enabled);
    setExtraText(next.extraDomains.join('\n'));
  }, []);
  useEffect(() => {
    if (!projectDocsApi.available()) return;
    let current = true;
    projectDocsApi.get(projectId).then(
      next => current && apply(next),
      reason => current && setError(reason),
    );
    return () => {
      current = false;
    };
  }, [projectId, apply]);
  const dirty = Boolean(
    docs && (enabled !== docs.enabled || domainLines(extraText).join('\n') !== docs.extraDomains.join('\n')),
  );
  useUnsavedChanges('la documentación en línea de los agentes', dirty);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await projectDocsApi.set(projectId, { enabled, extraDomains: domainLines(extraText) }));
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (docs) apply(docs);
    setError(null);
  };
  return { docs, enabled, setEnabled, extraText, setExtraText, dirty, busy, error, save, cancel };
}
