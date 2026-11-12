import {
  MAX_SURVEY_CAPABILITIES,
  MAX_SURVEY_EVIDENCE,
  MAX_SURVEY_MODULES,
  MAX_SURVEY_NOTES,
  type RepositorySurveyDto,
  type SurveyCapabilityDto,
  type SurveyModuleDto,
  type SurveyNoteDto,
} from '../../../shared/contracts/repository-survey.js';

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const line = (value: unknown, max: number) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
const cleanPath = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');

/**
 * The engine's inventory checked against the files Git tracks at the surveyed commit (plan REP, R3): a path that does
 * not exist is dropped, a capability left without evidence is dropped, and so is a module left with nothing. The map
 * is evidence, not opinion.
 */
export function normalizeSurvey(
  raw: unknown,
  tracked: readonly string[],
  at: { ref: string; commit: string },
): RepositorySurveyDto {
  const files = new Set(tracked);
  const folders = new Set(
    tracked.flatMap(file =>
      file
        .split('/')
        .slice(0, -1)
        .map((_, i, parts) => parts.slice(0, i + 1).join('/')),
    ),
  );
  const isFile = (path: string) => files.has(path);
  const exists = (path: string) => files.has(path) || folders.has(path);
  const evidence = (value: unknown, keep: (path: string) => boolean = isFile) => [
    ...new Set(list(value).map(cleanPath).filter(keep)),
  ];
  const input = record(raw);
  const modules = list(input.modules)
    .map(item => surveyModule(record(item), evidence, exists))
    .filter((module): module is SurveyModuleDto => !!module)
    .slice(0, MAX_SURVEY_MODULES);
  const note = (item: unknown): SurveyNoteDto => ({
    description: line(record(item).description, 300),
    evidence: evidence(record(item).evidence, exists).slice(0, MAX_SURVEY_EVIDENCE),
  });
  const notes = (value: unknown) =>
    list(value)
      .map(note)
      .filter(item => item.description && item.evidence.length)
      .slice(0, MAX_SURVEY_NOTES);
  return {
    modules,
    entryPoints: notes(input.entryPoints),
    tests: note(input.tests),
    pending: notes(input.pending),
    ref: at.ref,
    commit: at.commit,
  };
}

function surveyModule(
  item: Raw,
  evidence: (value: unknown, keep?: (path: string) => boolean) => string[],
  exists: (path: string) => boolean,
): SurveyModuleDto | null {
  const name = line(item.name, 80);
  if (!name) return null;
  const capabilities = list(item.capabilities)
    .map((raw): SurveyCapabilityDto | null => {
      const capability = record(raw);
      const title = line(capability.title, 120),
        files = evidence(capability.evidence).slice(0, MAX_SURVEY_EVIDENCE);
      if (!title || !files.length) return null;
      const status = capability.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE';
      return {
        title,
        summary: line(capability.summary, 400),
        status,
        evidence: files,
        missing: status === 'PARTIAL' ? line(capability.missing, 400) : '',
      };
    })
    .filter((capability): capability is SurveyCapabilityDto => !!capability)
    .slice(0, MAX_SURVEY_CAPABILITIES);
  const paths = evidence(item.paths, exists).slice(0, MAX_SURVEY_EVIDENCE);
  if (!capabilities.length && !paths.length) return null;
  return { name, summary: line(item.summary, 400), paths, capabilities };
}

/** Every distinct file the map cites, in order of appearance (capabilities first). */
export function surveyFiles(survey: RepositorySurveyDto): string[] {
  return [...new Set(survey.modules.flatMap(module => module.capabilities.flatMap(item => item.evidence)))];
}
