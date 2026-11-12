import { describe, expect, it } from 'vitest';
import {
  buildProposalPrompt,
  buildQuestionsPrompt,
} from '../../src/modules/inception/infrastructure/inception-contract.js';
import { normalizeInferences } from '../../src/modules/inception/application/repository-evidence.js';
import { checkAgainstMap } from '../../src/modules/inception/application/survey-plan.js';
import type { InceptionProjectInput } from '../../src/modules/inception/application/ports/inception-port.js';
import type { RepositoryScanDto } from '../../src/shared/contracts/repository-scan.js';
import type { RepositorySurveyDto } from '../../src/shared/contracts/repository-survey.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';

const scan = {
  repositoryName: 'tienda',
  totalFiles: 3,
  truncated: false,
  hasCode: true,
  languages: [],
  topLevel: ['README.md', 'package.json', 'src/'],
  directories: [{ path: 'src', files: 2 }],
  files: [{ path: 'README.md', kind: 'README', bytes: 20, truncated: false, content: '# Tienda de ropa' }],
  excluded: { ignored: 0, generated: 0, symlinks: 0, secrets: 0 },
  warnings: [],
  scannedAt: 'now',
} as unknown as RepositoryScanDto;
const map: RepositorySurveyDto = {
  modules: [
    {
      name: 'Carrito',
      summary: '',
      paths: ['src/cart'],
      capabilities: [
        { title: 'Añadir al carrito', summary: '', status: 'COMPLETE', evidence: ['src/cart/a.ts'], missing: '' },
        { title: 'Cupones', summary: '', status: 'PARTIAL', evidence: ['src/cart/c.ts'], missing: 'Porcentaje.' },
      ],
    },
  ],
  entryPoints: [],
  tests: { description: '', evidence: [] },
  pending: [],
  ref: 'main',
  commit: 'abc',
};
const project = (withMap: boolean): InceptionProjectInput => ({
  name: 'Tienda',
  description: null,
  brief: 'Quiero cupones de porcentaje',
  rootId: 'root',
  repository: {
    scan,
    inferences: [{ id: 'inf-1', area: 'VISION', statement: 'Tienda de ropa en línea.', evidence: ['README.md'] }],
    corrections: [],
    ...(withMap
      ? { survey: { status: 'DONE' as const, survey: map, error: null, startedAt: 'a', finishedAt: 'b' } }
      : {}),
  },
});

describe('questions of the next milestone (plan REP, R4)', () => {
  it('with a repository asks about the milestone and infers the vision; a new project keeps the old script', () => {
    const brownfield = buildQuestionsPrompt(project(false));
    expect(brownfield).toContain('NEXT MILESTONE');
    expect(brownfield).toContain('what must NOT be touched');
    expect(brownfield).toContain('ONE inference of area VISION');
    expect(brownfield).toContain('do NOT ask who uses it');
    const { repository: _repository, ...empty } = project(false);
    const greenfield = buildQuestionsPrompt(empty);
    expect(greenfield).toContain('who uses it, which problem it solves');
    expect(greenfield).not.toContain('NEXT MILESTONE');
  });

  it('a VISION inference survives with evidence like any other', () => {
    expect(
      normalizeInferences([{ area: 'vision', statement: 'Tienda de ropa.', evidence: ['README.md'] }], scan),
    ).toEqual([{ id: 'inf-1', area: 'VISION', statement: 'Tienda de ropa.', evidence: ['README.md'] }]);
  });

  it('the proposal builds on the milestone, with or without the map', () => {
    for (const withMap of [false, true]) {
      const prompt = buildProposalPrompt(project(withMap), [], []);
      expect(prompt).toContain('(f) The answers are about the NEXT MILESTONE');
      expect(prompt).toContain('(c) "rules" record the conventions');
      expect(prompt.includes('«Fundación» is OPTIONAL')).toBe(withMap);
    }
  });

  it('tasks that finish a partial capability say «Completar», and repeating a done one is a problem', () => {
    const operations: ChangeOperation[] = [
      {
        type: 'CREATE_WORK_ITEM',
        tempId: '$t',
        parentId: '$map_feat_1_2',
        workType: 'TASK',
        title: 'Crear cupones de porcentaje',
        summary: '',
        acceptanceCriteria: [],
      },
      {
        type: 'CREATE_WORK_ITEM',
        tempId: '$u',
        parentId: '$f',
        workType: 'TASK',
        title: 'Crear la vista',
        summary: '',
        acceptanceCriteria: [],
      },
      {
        type: 'CREATE_FEATURE',
        tempId: '$f',
        moduleId: '$map_mod_1',
        title: 'Añadir al  carrito',
        summary: '',
        scope: '',
        priority: 'LOW',
      },
    ];
    const checked = checkAgainstMap(operations, map);
    expect(checked.operations.map(op => ('title' in op ? op.title : ''))).toEqual([
      'Completar cupones de porcentaje',
      'Crear la vista',
      'Añadir al  carrito',
    ]);
    expect(checked.problems).toEqual([
      '«Añadir al  carrito» ya existe según el mapa del código («Añadir al carrito»).',
    ]);
    expect(checkAgainstMap(operations, null)).toEqual({ operations, problems: [] });
  });
});
