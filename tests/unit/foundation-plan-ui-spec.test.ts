import { describe, expect, it } from 'vitest';
import { buildFoundationPlan } from '../../src/modules/inception/application/foundation-plan.js';
import { buildProposalPrompt, uiSpecRule } from '../../src/modules/inception/infrastructure/inception-contract.js';
import { UI_SPEC_PATH, UI_SPEC_SECTIONS } from '../../src/shared/ui-spec.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import { proposal } from '../integration/inception-fixtures.js';

const spec = (
  sections: readonly string[] = UI_SPEC_SECTIONS,
  tempId: string | undefined = '$ui_spec',
): ChangeOperation => ({
  type: 'UPSERT_ARTIFACT',
  ...(tempId ? { tempId } : {}),
  parentId: null,
  artifactType: 'SPEC',
  title: 'Interfaz',
  relativePath: UI_SPEC_PATH,
  markdownContent: sections.map(section => `## ${section}\n\ntexto`).join('\n\n'),
});
const base = () =>
  proposal().map(op =>
    op.type === 'CREATE_RELATIONSHIP' && op.targetId === 'ROOT' ? { ...op, targetId: 'root' } : op,
  );
const links = (operations: ChangeOperation[]) =>
  operations.filter(op => op.type === 'CREATE_RELATIONSHIP' && op.edgeType === 'DOCUMENTED_BY');

describe('V3: the interface specification of an approved design', () => {
  it('links the specification to every feature, once, and asks nothing when no design was approved', () => {
    const features = base().filter(op => op.type === 'CREATE_FEATURE').length;
    const plan = buildFoundationPlan([...base(), spec()], 'root', { uiSpec: true });
    expect(plan.problems).toEqual([]);
    expect(links(plan.operations)).toHaveLength(features);
    expect(new Set(links(plan.operations).map(op => op.type === 'CREATE_RELATIONSHIP' && op.targetId))).toEqual(
      new Set(['$ui_spec']),
    );
    const again = buildFoundationPlan(plan.operations, 'root', { uiSpec: true });
    expect(links(again.operations)).toHaveLength(features);
    expect(buildFoundationPlan(base(), 'root').problems).toEqual([]);
    expect(links(buildFoundationPlan(base(), 'root').operations)).toHaveLength(0);
  });

  it('reports a missing specification or a missing section, and gives a nameless one a temporary id', () => {
    expect(buildFoundationPlan(base(), 'root', { uiSpec: true }).problems.join(' ')).toContain(UI_SPEC_PATH);
    const partial = buildFoundationPlan([...base(), spec(UI_SPEC_SECTIONS.slice(0, 6))], 'root', { uiSpec: true });
    expect(partial.problems.join(' ')).toContain('Sistema de diseño, Decisiones visuales');
    const nameless = buildFoundationPlan([...base(), spec(UI_SPEC_SECTIONS, undefined)], 'root', { uiSpec: true });
    expect(nameless.problems).toEqual([]);
    expect(
      links(nameless.operations).every(op => op.type === 'CREATE_RELATIONSHIP' && op.targetId === '$ui_spec'),
    ).toBe(true);
  });

  it('the proposal prompt demands the specification only when a direction was approved', () => {
    const project = { name: 'Tareas', description: null, brief: 'x', rootId: 'root' };
    const direction = {
      title: 'Panel',
      summary: 's',
      navigation: 'n',
      screens: ['Inicio'],
      designSystemNotes: [],
      source: 'GENERATED' as const,
    };
    expect(uiSpecRule(project)).toBe('');
    const prompt = buildProposalPrompt({ ...project, direction }, [], []);
    for (const section of UI_SPEC_SECTIONS) expect(prompt).toContain(`"## ${section}"`);
    expect(prompt).toContain('relativePath "docs/UI_SPEC.md"');
    expect(prompt).toContain('docs/design/prototype.html');
    expect(buildProposalPrompt(project, [], [])).not.toContain('UI_SPEC');
  });
});
