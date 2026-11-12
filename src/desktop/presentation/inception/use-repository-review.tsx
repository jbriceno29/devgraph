import { useState, type ReactNode } from 'react';
import type { InceptionIpcClient, InceptionViewDto } from '../../../shared/contracts/inception-view.js';
import type { AgentAccessEditDto, RepositoryCorrectionDto } from '../../../shared/contracts/repository-scan.js';
import { RepositoryFindings } from './RepositoryFindings.js';

/**
 * Brownfield review of the inception: the user's corrections of what was inferred and their edit of what the agent may
 * touch (plan REP, R1), sent with the answers. Both replace the earlier ones in the core.
 */
export function useRepositoryReview(projectId: string, view: InceptionViewDto | null) {
  const [corrections, setCorrections] = useState<Record<string, string> | null>(null),
    [access, setAccess] = useState<AgentAccessEditDto | null>(null);
  const repository = view?.repository ?? null;
  const editedCorrections =
    corrections ?? Object.fromEntries((repository?.corrections ?? []).map(item => [item.inferenceId, item.correction]));
  const correctionList: RepositoryCorrectionDto[] = (repository?.inferences ?? []).flatMap(item => {
    const text = (editedCorrections[item.id] ?? '').trim();
    return text ? [{ inferenceId: item.id, correction: text }] : [];
  });
  const findings: ReactNode = repository && (
    <RepositoryFindings
      repository={repository}
      corrections={editedCorrections}
      open
      onCorrect={(id, text) => setCorrections({ ...editedCorrections, [id]: text })}
      access={access}
      onAccessChange={setAccess}
      projectId={projectId}
    />
  );
  /** Sends the answers; in brownfield mode the corrections and the access edit go with them. */
  const sendAnswers = (
    ipc: InceptionIpcClient,
    answers: Parameters<InceptionIpcClient['answer']>[1],
    design?: boolean,
  ) => {
    const extra = repository ? { corrections: correctionList, ...(access ? { access } : {}) } : null;
    return design !== undefined
      ? ipc.answer(projectId, answers, undefined, { exploreUi: design, ...extra })
      : extra
        ? ipc.answer(projectId, answers, undefined, extra)
        : ipc.answer(projectId, answers);
  };
  const reset = () => {
    setCorrections(null);
    setAccess(null);
  };
  return { findings, sendAnswers, reset };
}
