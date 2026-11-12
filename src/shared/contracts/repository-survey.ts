/**
 * Plan REP, R3: the map of what an existing repository already has, from a read-only survey run (Read, Glob and Grep
 * on a copy of the base branch). Every path is one `git ls-files` lists at the surveyed commit; a capability without
 * evidence is dropped.
 */
export type SurveyCapabilityStatus = 'COMPLETE' | 'PARTIAL';

export interface SurveyCapabilityDto {
  title: string;
  summary: string;
  status: SurveyCapabilityStatus;
  /** Files that show it works (1 to MAX_SURVEY_EVIDENCE). */
  evidence: string[];
  /** For a PARTIAL capability: what is missing or half done (empty when COMPLETE). */
  missing: string;
}
export interface SurveyModuleDto {
  name: string;
  summary: string;
  /** Folders or files the module lives in. */
  paths: string[];
  capabilities: SurveyCapabilityDto[];
}
export interface SurveyNoteDto {
  description: string;
  evidence: string[];
}
export interface RepositorySurveyDto {
  modules: SurveyModuleDto[];
  /** Where the program starts (a server, a CLI, the app's root component…). */
  entryPoints: SurveyNoteDto[];
  /** How the tests are organised and run. */
  tests: SurveyNoteDto;
  /** Visible pending work: TODO comments, half-written functions, stubs. */
  pending: SurveyNoteDto[];
  /** Branch and commit the survey read. */
  ref: string;
  commit: string;
}
export type SurveyStatus = 'RUNNING' | 'DONE' | 'FAILED';
export interface RepositorySurveyStateDto {
  status: SurveyStatus;
  survey: RepositorySurveyDto | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export const MAX_SURVEY_MODULES = 8,
  MAX_SURVEY_CAPABILITIES = 8,
  MAX_SURVEY_EVIDENCE = 5,
  MAX_SURVEY_NOTES = 8;
/** Where the map is written when the proposal is approved. */
export const CODE_MAP_PATH = 'docs/MAPA_DEL_CODIGO.md';
