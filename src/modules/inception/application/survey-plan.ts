import type { ChangeOperation } from '../../knowledge/index.js';
import {
  CODE_MAP_PATH,
  type RepositorySurveyDto,
  type SurveyModuleDto,
} from '../../../shared/contracts/repository-survey.js';
import { codeMapMarkdown } from './code-map-document.js';

/** Temporary ids of what the map creates: the proposal hangs new work on them, and only the app may create them. */
export const MAP_PREFIX = '$map_';
export const mapModuleId = (index: number) => `${MAP_PREFIX}mod_${index + 1}`;
export const mapFeatureId = (module: number, capability: number) => `${MAP_PREFIX}feat_${module + 1}_${capability + 1}`;
const CODE_MAP_ID = `${MAP_PREFIX}doc`;
/** At most this many files of the map become CODE_REFERENCE nodes (the context passes at most 40 as pointers). */
export const MAX_MAP_FILES = 80;
const SURVEY_ORIGIN = { origin: 'SURVEY' };
const EXISTING = 'Ya existe en el repositorio (mapa del código).';

/** The CODE_REFERENCE nodes of the map (one per file, capped) and the TOUCHES_CODE edges to them, without repeats. */
class CodeLinks {
  readonly nodes: ChangeOperation[] = [];
  readonly edges: ChangeOperation[] = [];
  private readonly ids = new Map<string, string>();
  private readonly seen = new Set<string>();
  constructor(private readonly commit: string) {}

  touch(sourceId: string, path: string): void {
    if (!this.ids.has(path) && this.ids.size < MAX_MAP_FILES) {
      this.ids.set(path, `${MAP_PREFIX}code_${this.ids.size + 1}`);
      this.nodes.push({
        type: 'CREATE_CODE_REFERENCE',
        tempId: this.ids.get(path)!,
        filePath: path,
        commitSha: this.commit,
      });
    }
    const target = this.ids.get(path);
    if (!target || this.seen.has(`${sourceId}>${target}`)) return;
    this.seen.add(`${sourceId}>${target}`);
    this.edges.push({
      type: 'CREATE_RELATIONSHIP',
      sourceId,
      targetId: target,
      edgeType: 'TOUCHES_CODE',
      metadata: SURVEY_ORIGIN,
    });
  }
}

/** One existing module and its capabilities (features DONE or PARTIAL), linked to their evidence. */
function moduleOperations(module: SurveyModuleDto, m: number, rootId: string, links: CodeLinks): ChangeOperation[] {
  const ops: ChangeOperation[] = [
    {
      type: 'CREATE_MODULE',
      tempId: mapModuleId(m),
      parentId: rootId,
      title: module.name,
      summary: module.summary,
      purpose: module.summary || module.name,
      moduleKind: 'FUNCTIONAL',
    },
  ];
  module.capabilities.forEach((capability, c) => {
    const id = mapFeatureId(m, c);
    ops.push(
      {
        type: 'CREATE_FEATURE',
        tempId: id,
        moduleId: mapModuleId(m),
        title: capability.title,
        summary: [capability.summary, capability.missing ? `Falta: ${capability.missing}` : '']
          .filter(Boolean)
          .join('\n\n'),
        scope: EXISTING,
        priority: 'MEDIUM',
      },
      {
        type: 'UPDATE_ENTITY_STATUS',
        entityId: id,
        newStatus: capability.status === 'PARTIAL' ? 'PARTIAL' : 'DONE',
        reason: EXISTING,
      },
    );
    for (const path of capability.evidence) {
      links.touch(id, path);
      links.touch(mapModuleId(m), path);
    }
  });
  return ops;
}

/**
 * Plan REP, R3: the map as graph operations, built by the app (never by the engine). Each module and capability that
 * already exists, capabilities DONE or PARTIAL, a CODE_REFERENCE per evidence file with TOUCHES_CODE from its capability
 * and its module (marked as coming from the survey), and docs/MAPA_DEL_CODIGO.md documenting every module.
 */
export function surveyOperations(survey: RepositorySurveyDto, rootId: string): ChangeOperation[] {
  if (!survey.modules.length) return [];
  const links = new CodeLinks(survey.commit);
  const modules = survey.modules.flatMap((module, m) => moduleOperations(module, m, rootId, links));
  const document: ChangeOperation = {
    type: 'UPSERT_ARTIFACT',
    tempId: CODE_MAP_ID,
    parentId: null,
    artifactType: 'ARCHITECTURE',
    title: 'Mapa del código',
    relativePath: CODE_MAP_PATH,
    markdownContent: codeMapMarkdown(survey),
  };
  const documented: ChangeOperation[] = survey.modules.map((_, m) => ({
    type: 'CREATE_RELATIONSHIP',
    sourceId: mapModuleId(m),
    targetId: CODE_MAP_ID,
    edgeType: 'DOCUMENTED_BY',
  }));
  return [...modules, ...links.nodes, document, ...links.edges, ...documented];
}

/** The engine's operations without anything that would collide with the map (it may only point at the map's ids). */
export function withoutMapCollisions(operations: ChangeOperation[]): ChangeOperation[] {
  return operations.filter(
    op =>
      !('tempId' in op && typeof op.tempId === 'string' && op.tempId.startsWith(MAP_PREFIX)) &&
      !(op.type === 'UPSERT_ARTIFACT' && op.relativePath === CODE_MAP_PATH) &&
      !(op.type === 'UPDATE_ENTITY_STATUS' && op.entityId.startsWith(MAP_PREFIX)),
  );
}
