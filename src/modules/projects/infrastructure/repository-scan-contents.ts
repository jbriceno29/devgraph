import { basename } from 'node:path';
import { type RepositoryScanFileDto, type RepositoryScanFileKind } from '../../../shared/contracts/repository-scan.js';
import {
  FILE_LIMIT,
  MAX_MANIFESTS,
  MANIFEST_NAMES,
  BUILD_CONFIG,
  styleRank,
  byteLength,
  cutBytes,
  MAX_STYLES,
  MAX_CI,
} from './repository-scan-rules.js';

export const depthOf = (path: string) => path.split('/').length;
export const lower = (path: string) => path.toLowerCase();

export type Candidate = { path: string; size: number; kind: RepositoryScanFileKind };

/** Which contents say most about the stack and the design system, in priority order. */
export function contentCandidates(files: Array<{ path: string; size: number }>): Candidate[] {
  const manifests = files
    .filter(
      file =>
        depthOf(file.path) <= 3 &&
        (MANIFEST_NAMES.has(lower(basename(file.path))) || BUILD_CONFIG.test(lower(basename(file.path)))),
    )
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_MANIFESTS);
  const readme = files.find(file => /^readme(?:\.md|\.txt)?$/.test(lower(file.path)));
  const styles = files
    .flatMap(file => {
      const rank = styleRank(file.path);
      return rank === null || depthOf(file.path) > 5 ? [] : [{ path: file.path, size: file.size, rank }];
    })
    .sort((a, b) => a.rank - b.rank || depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_STYLES);
  const ci = files
    .filter(
      file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(lower(file.path)) || lower(file.path) === '.gitlab-ci.yml',
    )
    .slice(0, MAX_CI);
  const style = ({ path, size }: { path: string; size: number }) => ({ path, size, kind: 'STYLE' as const });
  return [
    ...manifests.filter(file => depthOf(file.path) === 1).map(file => ({ ...file, kind: 'MANIFEST' as const })),
    ...(readme ? [{ ...readme, kind: 'README' as const }] : []),
    ...styles.slice(0, 3).map(style),
    ...manifests.filter(file => depthOf(file.path) > 1).map(file => ({ ...file, kind: 'MANIFEST' as const })),
    ...styles.slice(3).map(style),
    ...ci.map(file => ({ ...file, kind: 'CI' as const })),
  ];
}

/** Fits an entry as it will be serialized (escaping makes JSON larger than the text); null when it cannot fit. */
export function fitEntry(entry: RepositoryScanFileDto, remaining: number): RepositoryScanFileDto | null {
  let budget = Math.min(FILE_LIMIT[entry.kind], remaining - byteLength(JSON.stringify({ ...entry, content: '' })) - 2);
  while (budget > 0 && byteLength(JSON.stringify(entry)) + 1 > remaining) {
    entry.content = cutBytes(entry.content, budget);
    entry.truncated = true;
    budget = Math.floor(budget * 0.85);
  }
  return byteLength(JSON.stringify(entry)) + 1 > remaining ? null : entry;
}
