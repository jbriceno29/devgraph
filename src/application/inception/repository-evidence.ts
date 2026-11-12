import {
  MAX_REPOSITORY_CORRECTION,
  REPOSITORY_INFERENCE_AREAS,
  type RepositoryCorrectionDto,
  type RepositoryInferenceArea,
  type RepositoryInferenceDto,
  type RepositoryScanDto,
} from '../../shared/contracts/repository-scan.js';

const MAX_INFERENCES = 8,
  MAX_EVIDENCE = 5;

/** The paths an inference may cite as evidence: files whose content was read, listed folders and root entries. */
export function evidencePaths(scan: RepositoryScanDto): Set<string> {
  return new Set([
    ...scan.files.map(file => file.path),
    ...scan.directories.map(dir => dir.path),
    ...scan.topLevel.map(entry => entry.replace(/\/$/, '')),
  ]);
}
const cleanPath = (value: string) => value.trim().replace(/^`|`$/g, '').replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * Keeps only inferences backed by the scan: a known area, a short statement and at least one evidence path that really exists in it (paths the
 * model made up are dropped, and an inference left without evidence is dropped). Ids are assigned here. This is what «with evidence» means in code.
 */
export function normalizeInferences(raw: unknown, scan: RepositoryScanDto): RepositoryInferenceDto[] {
  if (!Array.isArray(raw)) return [];
  const known = evidencePaths(scan);
  const out: RepositoryInferenceDto[] = [];
  for (const item of raw) {
    const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const area = String(value.area ?? '').toUpperCase() as RepositoryInferenceArea;
    const statement =
      typeof value.statement === 'string' ? value.statement.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    const evidence = [
      ...new Set(
        (Array.isArray(value.evidence) ? value.evidence : [])
          .filter((path): path is string => typeof path === 'string')
          .map(cleanPath)
          .filter(path => known.has(path)),
      ),
    ].slice(0, MAX_EVIDENCE);
    if (!REPOSITORY_INFERENCE_AREAS.includes(area) || !statement || !evidence.length) continue;
    out.push({ id: `inf-${out.length + 1}`, area, statement, evidence });
    if (out.length >= MAX_INFERENCES) break;
  }
  return out;
}

/** The user's corrections, checked: each names a known inference once, is trimmed and capped; an empty one means «it is right». Throws a message for the user. */
export function normalizeCorrections(
  input: unknown,
  inferences: readonly RepositoryInferenceDto[],
): RepositoryCorrectionDto[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('Las correcciones deben enviarse como una lista.');
  const ids = new Set(inferences.map(item => item.id)),
    seen = new Set<string>();
  const out: RepositoryCorrectionDto[] = [];
  for (const item of input) {
    const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const inferenceId = String(value.inferenceId ?? '');
    if (!ids.has(inferenceId))
      throw new Error(`La corrección no corresponde a nada de lo detectado: ${inferenceId || '(vacía)'}.`);
    if (seen.has(inferenceId)) continue;
    seen.add(inferenceId);
    const correction = String(value.correction ?? '').trim();
    if (correction.length > MAX_REPOSITORY_CORRECTION)
      throw new Error(`Cada corrección admite como mucho ${MAX_REPOSITORY_CORRECTION} caracteres.`);
    if (correction) out.push({ inferenceId, correction });
  }
  return out;
}
