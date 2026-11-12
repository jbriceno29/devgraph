import type { ChangeOperation } from '../../knowledge/index.js';
import { proposeAgentAccess, writablePathIssue, type AgentAccessProposal } from '../../projects/index.js';
import { profileIssues } from '../../projects/index.js';
import type {
  AgentAccessDto,
  AgentAccessEditDto,
  RepositoryScanDto,
} from '../../../shared/contracts/repository-scan.js';
import type { InceptionRepositoryState } from './ports/inception-port.js';
import { normalizeCorrections } from './repository-evidence.js';

/** Plan REP, R1: what the scan suggests the agent may write and run, before the user edits it. */
export function suggestedAccess(scan: Pick<RepositoryScanDto, 'topLevel' | 'files'>): AgentAccessProposal {
  const manifest = scan.files.find(file => file.path === 'package.json' && file.kind === 'MANIFEST');
  return proposeAgentAccess({ topLevel: scan.topLevel, packageJson: manifest?.content ?? null });
}

/** The access the proposal will save: the user's edit when there is one, otherwise the suggestion. */
export function accessView(repository: InceptionRepositoryState): AgentAccessDto {
  const suggested = suggestedAccess(repository.scan);
  if (!repository.access) return { ...suggested, edited: false };
  const reasons = new Map(suggested.writable.map(path => [path.pattern, path.reason]));
  return {
    writable: repository.access.writablePaths.map(pattern => ({ pattern, reason: reasons.get(pattern) ?? 'USER' })),
    verificationCommands: repository.access.verificationCommands,
    edited: true,
  };
}

/** Validates the user's edit of the access (Spanish errors); null restores the suggestion. */
export function normalizeAccessEdit(raw: unknown): AgentAccessEditDto | null {
  if (raw === null) return null;
  const value = (raw ?? {}) as { writablePaths?: unknown; verificationCommands?: unknown };
  const clean = (list: unknown) =>
    [...new Set((Array.isArray(list) ? list : []).map(item => String(item ?? '').trim()))].filter(Boolean);
  const writablePaths = clean(value.writablePaths).map(path => path.replace(/^\.\//, '')),
    verificationCommands = clean(value.verificationCommands);
  const problems = [
    ...(writablePaths.length ? [] : ['Indica al menos una ruta que el agente pueda escribir.']),
    ...writablePaths.flatMap(path => writablePathIssue(path) ?? []),
    ...profileIssues({ objectives: ['-'], outOfScope: [], rules: [], techStack: { x: '-' }, verificationCommands }),
  ];
  if (problems.length) throw new Error(problems.join(' '));
  return { writablePaths, verificationCommands };
}

/** The repository state after the user's answer: corrections and access edits replace the earlier ones when given. */
export function editedRepository(
  repository: InceptionRepositoryState | null,
  options: { corrections?: unknown; access?: unknown } | undefined,
): InceptionRepositoryState | null {
  const corrections = options?.corrections,
    access = options?.access;
  if (!repository) {
    if ((Array.isArray(corrections) && corrections.length) || (access !== undefined && access !== null))
      throw new Error('No hay nada detectado en el repositorio que corregir.');
    return null;
  }
  return {
    ...repository,
    ...(corrections !== undefined && corrections !== null
      ? { corrections: normalizeCorrections(corrections, repository.inferences) }
      : {}),
    ...(access !== undefined ? { access: normalizeAccessEdit(access) } : {}),
  };
}

/** The proposal of an existing repository saves its access in the policy (writable paths and checks). */
export function withAgentAccess(
  operations: ChangeOperation[],
  repository: InceptionRepositoryState | null,
): ChangeOperation[] {
  if (!repository) return operations;
  const access = accessView(repository);
  return operations.map(op =>
    op.type === 'SET_PROJECT_PROFILE'
      ? {
          ...op,
          writablePaths: access.writable.map(path => path.pattern),
          ...(access.verificationCommands.length ? { verificationCommands: access.verificationCommands } : {}),
        }
      : op,
  );
}
