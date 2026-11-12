/**
 * Brownfield mode: what the app reads from a repository that already has code, so the inception assistant can infer the stack and
 * the design system WITH EVIDENCE. Only metadata, manifests, folder structure and style files are read: `.gitignore` is respected,
 * symbolic links are never followed, credential-like files are never opened, nothing leaves the repository and nothing is executed.
 * The whole scan, serialized, never exceeds MAX_SCAN_BYTES: it is exactly what the model may receive, always as inert data.
 */
export const MAX_SCAN_BYTES = 48 * 1024;
/** Kind of file whose content was read: dependency/runtime manifests, style and design-token files, the README, CI workflows. */
export type RepositoryScanFileKind = 'MANIFEST' | 'STYLE' | 'README' | 'CI';
export interface RepositoryScanFileDto {
  /** Relative to the repository root, with `/`. */
  path: string;
  kind: RepositoryScanFileKind;
  /** Size on disk. */
  bytes: number;
  /** The content was cut to fit the limits (for a large style file only its token lines are kept). */
  truncated: boolean;
  /** Text read (secret-looking values redacted). */
  content: string;
}
export interface RepositoryScanDto {
  repositoryName: string;
  /** Files listed after excluding ignored, generated, symlinked and credential-like ones. */
  totalFiles: number;
  /** The listing stopped at the file limit. */
  truncated: boolean;
  /** Anything besides README, .gitignore, LICENSE and docs/ (an empty repository created by the app has no code). */
  hasCode: boolean;
  /** Files per language, by extension, most frequent first. */
  languages: Array<{ language: string; files: number }>;
  /** Entries at the root (folders end with `/`). */
  topLevel: string[];
  /** Folders up to three levels deep with the number of files below them. */
  directories: Array<{ path: string; files: number }>;
  /** Files whose content was read, in priority order. */
  files: RepositoryScanFileDto[];
  /** What the policy left out, by reason (counts only; their names are never read). */
  excluded: { ignored: number; generated: number; symlinks: number; secrets: number };
  warnings: string[];
  scannedAt: string;
}
/** The view of a scan: the same without file contents (the inception view is polled every few seconds). */
export type RepositoryScanSummaryDto = Omit<RepositoryScanDto, 'files'> & {
  files: Array<Omit<RepositoryScanFileDto, 'content'>>;
  bytes: number;
};

/** What the assistant inferred from the scan. Every inference names its evidence: paths that exist in the scan (others are dropped in code). */
export type RepositoryInferenceArea = 'STACK' | 'DESIGN_SYSTEM' | 'STRUCTURE' | 'TESTING';
export const REPOSITORY_INFERENCE_AREAS: readonly RepositoryInferenceArea[] = [
  'STACK',
  'DESIGN_SYSTEM',
  'STRUCTURE',
  'TESTING',
];
export interface RepositoryInferenceDto {
  id: string;
  area: RepositoryInferenceArea;
  statement: string;
  evidence: string[];
}
/** The user's correction of one inference (it takes precedence over the inference in every later prompt). */
export interface RepositoryCorrectionDto {
  inferenceId: string;
  correction: string;
}
export const MAX_REPOSITORY_CORRECTION = 500;
/** Why the agent may write a path (plan REP, R1): code and assets, tests, root configuration, or outputs the app creates. */
export type AgentAccessReason = 'CODE' | 'TESTS' | 'CONFIG' | 'DOCS' | 'GENERATED' | 'USER';
/** The user's version of the agent's access: replaces what the scan suggests. */
export interface AgentAccessEditDto {
  writablePaths: string[];
  verificationCommands: string[];
}
/** What the repository suggests for the agent's access (no user edits). */
export interface AgentAccessProposalDto {
  writable: Array<{ pattern: string; reason: AgentAccessReason }>;
  verificationCommands: string[];
}
/** What the agent will be able to touch and which checks verify it, as the proposal will save it in the policy. */
export interface AgentAccessDto {
  writable: Array<{ pattern: string; reason: AgentAccessReason }>;
  verificationCommands: string[];
  /** The user changed the suggestion. */
  edited: boolean;
}
/** The repository part of the inception view: what was read, what the assistant inferred and what the user corrected. */
export interface InceptionRepositoryDto {
  scan: RepositoryScanSummaryDto;
  inferences: RepositoryInferenceDto[];
  corrections: RepositoryCorrectionDto[];
  /** Absent in views from an older core. */
  access?: AgentAccessDto;
}

/** The view of a scan, without contents, with the serialized size of the full scan. */
export function summarizeScan(scan: RepositoryScanDto): RepositoryScanSummaryDto {
  return {
    ...scan,
    files: scan.files.map(({ content: _content, ...rest }) => rest),
    bytes: new TextEncoder().encode(JSON.stringify(scan)).length,
  };
}
