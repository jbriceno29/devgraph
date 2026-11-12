import { describe, expect, it } from 'vitest';
import { normalizeSurvey, surveyFiles } from '../../src/modules/inception/application/repository-survey.js';
import {
  MAX_MAP_FILES,
  surveyOperations,
  withoutMapCollisions,
} from '../../src/modules/inception/application/survey-plan.js';
import { codeMapMarkdown } from '../../src/modules/inception/application/code-map-document.js';
import { buildFoundationPlan } from '../../src/modules/inception/application/foundation-plan.js';
import { summarizeFoundationPlan } from '../../src/modules/inception/application/foundation-summary.js';
import { ChangeSetValidator } from '../../src/modules/planning/application/changeset-validator.js';
import { normalizeOperation } from '../../src/modules/planning/infrastructure/change-set-planning-contract.js';
import type { ChangeOperation, ChangeSet } from '../../src/modules/knowledge/domain/change-set.js';
import type { KnowledgeEntity } from '../../src/modules/knowledge/domain/knowledge-entity.js';
import type { RepositorySurveyDto } from '../../src/shared/contracts/repository-survey.js';

const tracked = ['src/cart/cart.ts', 'src/cart/total.ts', 'src/app.ts', 'tests/cart.test.ts', 'README.md'];
const at = { ref: 'main', commit: 'abc123def4567890' };
const survey = (): RepositorySurveyDto =>
  normalizeSurvey(
    {
      modules: [
        {
          name: 'Carrito',
          summary: 'Líneas y total.',
          paths: ['src/cart/', './src/cart', 'src/nope'],
          capabilities: [
            {
              title: 'Añadir al carrito',
              summary: 'a',
              status: 'COMPLETE',
              missing: 'ignorado',
              evidence: ['src/cart/cart.ts'],
            },
            {
              title: 'Descuentos',
              summary: 'b',
              status: 'PARTIAL',
              missing: 'Cupones.',
              evidence: ['src/cart/total.ts', '../etc/passwd'],
            },
            { title: 'Sin evidencia', summary: 'c', status: 'COMPLETE', missing: '', evidence: ['src/cart'] },
          ],
        },
        { name: '', summary: '', paths: ['src'], capabilities: [] },
      ],
      entryPoints: [
        { description: 'Arranque', evidence: ['src/app.ts'] },
        { description: 'Inventado', evidence: ['x.ts'] },
      ],
      tests: { description: 'Vitest', evidence: ['tests'] },
      pending: 'no es una lista',
    },
    tracked,
    at,
  );

describe('the survey map is evidence, not opinion (plan REP, R3)', () => {
  it('keeps only paths Git tracks: files for capabilities, files or folders for modules and notes', () => {
    const map = survey();
    expect(map.modules).toHaveLength(1);
    expect(map.modules[0]).toMatchObject({ name: 'Carrito', paths: ['src/cart'] });
    expect(map.modules[0]!.capabilities).toEqual([
      { title: 'Añadir al carrito', summary: 'a', status: 'COMPLETE', evidence: ['src/cart/cart.ts'], missing: '' },
      { title: 'Descuentos', summary: 'b', status: 'PARTIAL', evidence: ['src/cart/total.ts'], missing: 'Cupones.' },
    ]);
    expect(map.entryPoints).toEqual([{ description: 'Arranque', evidence: ['src/app.ts'] }]);
    expect(map.tests).toEqual({ description: 'Vitest', evidence: ['tests'] });
    expect(map.pending).toEqual([]);
    expect(map).toMatchObject(at);
    expect(surveyFiles(map)).toEqual(['src/cart/cart.ts', 'src/cart/total.ts']);
    expect(normalizeSurvey(null, tracked, at).modules).toEqual([]);
  });

  it('becomes graph operations the validator accepts: modules, done or partial features, code references and the document', () => {
    const ops = surveyOperations(survey(), 'root');
    expect(
      ops.filter(op => op.type === 'UPDATE_ENTITY_STATUS').map(op => (op as { newStatus: string }).newStatus),
    ).toEqual(['DONE', 'PARTIAL']);
    expect(ops.filter(op => op.type === 'CREATE_CODE_REFERENCE')).toEqual([
      { type: 'CREATE_CODE_REFERENCE', tempId: '$map_code_1', filePath: 'src/cart/cart.ts', commitSha: at.commit },
      { type: 'CREATE_CODE_REFERENCE', tempId: '$map_code_2', filePath: 'src/cart/total.ts', commitSha: at.commit },
    ]);
    const touches = ops.filter(op => op.type === 'CREATE_RELATIONSHIP' && op.edgeType === 'TOUCHES_CODE');
    expect(touches).toHaveLength(4);
    expect(touches.every(op => (op as { metadata?: unknown }).metadata && JSON.stringify(op).includes('SURVEY'))).toBe(
      true,
    );
    const document = ops.find(op => op.type === 'UPSERT_ARTIFACT') as Extract<
      ChangeOperation,
      { type: 'UPSERT_ARTIFACT' }
    >;
    expect(document).toMatchObject({ relativePath: 'docs/MAPA_DEL_CODIGO.md', artifactType: 'ARCHITECTURE' });
    expect(document.markdownContent).toContain('**Descuentos** (parcial)');
    expect(document.markdownContent).toContain('Falta: Cupones.');
    expect(validate(ops).issues).toEqual([]);
    expect(surveyOperations({ ...survey(), modules: [] }, 'root')).toEqual([]);
  });

  it('caps the code references and never lets the engine create or retouch what the map creates', () => {
    const files = Array.from({ length: MAX_MAP_FILES + 5 }, (_, i) => `src/f${i}.ts`);
    const big = normalizeSurvey(
      {
        modules: Array.from({ length: 30 }, (_, m) => ({
          name: `M${m}`,
          summary: '',
          paths: [],
          capabilities: [
            { title: 'c', summary: '', status: 'COMPLETE', missing: '', evidence: files.slice(m * 3, m * 3 + 3) },
          ],
        })),
        entryPoints: [],
        tests: {},
        pending: [],
      },
      files,
      at,
    );
    expect(big.modules).toHaveLength(8);
    expect(surveyOperations(big, 'root').filter(op => op.type === 'CREATE_CODE_REFERENCE').length).toBeLessThanOrEqual(
      MAX_MAP_FILES,
    );
    expect(
      withoutMapCollisions([
        { type: 'CREATE_MODULE', tempId: '$map_mod_1', title: 'x', summary: '', purpose: '' },
        { type: 'UPDATE_ENTITY_STATUS', entityId: '$map_feat_1_1', newStatus: 'ARCHIVED', reason: '' },
        {
          type: 'UPSERT_ARTIFACT',
          tempId: '$m',
          artifactType: 'OTHER',
          title: 'x',
          relativePath: 'docs/MAPA_DEL_CODIGO.md',
          markdownContent: '',
        },
        {
          type: 'CREATE_FEATURE',
          tempId: '$f',
          moduleId: '$map_mod_1',
          title: 'Nueva',
          summary: '',
          scope: '',
          priority: 'LOW',
        },
      ]).map(op => op.type),
    ).toEqual(['CREATE_FEATURE']);
    // An engine cannot produce a code reference at all.
    expect(() =>
      normalizeOperation({ type: 'CREATE_CODE_REFERENCE', tempId: '$c', filePath: 'a.ts' }, 'Claude Code'),
    ).toThrow(/desconocido/);
  });

  it('the validator rejects an unsafe code path and a feature status that does not exist', () => {
    const issues = validate([
      { type: 'CREATE_CODE_REFERENCE', tempId: '$c', filePath: '../fuera.ts', commitSha: 'x' },
      { type: 'CREATE_FEATURE', tempId: '$f', moduleId: 'mod', title: 'F', summary: '', scope: '', priority: 'LOW' },
      { type: 'UPDATE_ENTITY_STATUS', entityId: '$f', newStatus: 'CASI', reason: '' },
    ]).issues.map(issue => issue.code);
    expect(issues).toEqual(['UNSAFE_CODE_PATH', 'INVALID_STATUS_TRANSITION']);
  });

  it('with a map, «Fundación» is optional and tasks that complete a partial capability wait for it when it exists', () => {
    const map = surveyOperations(survey(), 'root');
    const base: ChangeOperation[] = [
      {
        type: 'SET_PROJECT_PROFILE',
        objectives: ['x'],
        outOfScope: [],
        techStack: { a: 'b' },
        rules: [],
        verificationCommands: ['npm test'],
      },
      {
        type: 'CREATE_DECISION_RECORD',
        tempId: '$adr',
        title: 'ADR',
        contextMd: '',
        alternativesMd: 'a',
        decisionMd: '',
        consequencesMd: '',
        relativePath: 'docs/a.md',
      },
      {
        type: 'CREATE_WORK_ITEM',
        tempId: '$t',
        parentId: '$map_feat_1_2',
        workType: 'TASK',
        title: 'Completar descuentos',
        summary: '',
        acceptanceCriteria: [],
      },
    ];
    const without = buildFoundationPlan(base, 'root', { brownfield: true, mapped: true });
    expect(without.problems).toEqual([]);
    expect(without.operations).toContainEqual(expect.objectContaining({ entityId: '$t', newStatus: 'READY' }));
    const withFoundation = buildFoundationPlan(
      [
        ...base,
        { type: 'CREATE_MODULE', tempId: '$base', title: 'Base', summary: '', purpose: '' },
        {
          type: 'CREATE_FEATURE',
          tempId: '$f0',
          moduleId: '$base',
          title: 'Fundación',
          summary: '',
          scope: '',
          priority: 'HIGH',
        },
        {
          type: 'CREATE_WORK_ITEM',
          tempId: '$readme',
          parentId: '$f0',
          workType: 'TASK',
          title: 'README',
          summary: '',
          acceptanceCriteria: [],
        },
      ],
      'root',
      { brownfield: true, mapped: true },
    );
    expect(withFoundation.problems).toEqual([]);
    expect(withFoundation.operations).toContainEqual({
      type: 'CREATE_RELATIONSHIP',
      sourceId: '$t',
      targetId: '$readme',
      edgeType: 'DEPENDS_ON',
    });
    const summary = summarizeFoundationPlan([...withFoundation.operations, ...map]);
    expect(summary.features.map(feature => feature.title)).toEqual(['Fundación', 'Descuentos']);
    expect(summary.existing).toEqual([
      {
        module: 'Carrito',
        capabilities: [
          { title: 'Añadir al carrito', status: 'COMPLETE' },
          { title: 'Descuentos', status: 'PARTIAL' },
        ],
      },
    ]);
    expect(codeMapMarkdown(survey())).toContain('`main` (commit `abc123def456`)');
  });
});

function validate(operations: ChangeOperation[]) {
  const entity = (id: string, entityType: string): KnowledgeEntity =>
    ({
      id,
      projectId: 'p',
      entityType,
      displayKey: id,
      title: id,
      summary: '',
      status: 'ACTIVE',
      parentId: entityType === 'MODULE' ? 'root' : null,
      createdRevision: 1,
      updatedRevision: 1,
      createdAt: 'n',
      updatedAt: 'n',
    }) as KnowledgeEntity;
  const changeSet: ChangeSet = {
    id: 'cs',
    projectId: 'p',
    baseGraphRevision: 1,
    originType: 'AI_CHAT',
    title: 't',
    rationale: '',
    status: 'PENDING_APPROVAL',
    operations,
    validationIssues: [],
    createdAt: 'n',
  };
  return new ChangeSetValidator().validate(changeSet, 1, [entity('root', 'PROJECT_ROOT'), entity('mod', 'MODULE')], []);
}
