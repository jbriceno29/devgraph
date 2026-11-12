import { describe, expect, it } from 'vitest';
import {
  APP_RULES,
  STACK_PROFILES,
  applyStackProfile,
  catalogForPrompt,
  findStackProfile,
} from '../../src/domain/projects/stack-catalog.js';
import { profileIssues } from '../../src/domain/projects/project-profile.js';
import { buildFoundationPlan } from '../../src/application/inception/foundation-plan.js';
import { buildProposalPrompt, proposalSchema } from '../../src/infrastructure/ai/inception-contract.js';
import type { ChangeOperation, ProjectProfile } from '../../src/domain/knowledge/change-set.js';
import { proposal } from '../integration/inception-fixtures.js';

describe('stack catalog (plan S1)', () => {
  it('every profile is a valid project profile, with unique ids, verification that calls installed binaries and no versioned packages', () => {
    expect(new Set(STACK_PROFILES.map(profile => profile.id)).size).toBe(STACK_PROFILES.length);
    for (const profile of STACK_PROFILES) {
      const merged = applyStackProfile(
        { objectives: ['x'], outOfScope: [], techStack: {}, rules: [], verificationCommands: [] },
        profile,
      );
      expect(profileIssues(merged), profile.id).toEqual([]);
      expect(profile.verificationCommands.length, profile.id).toBeGreaterThan(0);
      if (profile.packageManager)
        for (const command of profile.verificationCommands)
          expect(command, profile.id).toMatch(/^node_modules\/\.bin\//);
      else expect([...profile.dependencies, ...profile.devDependencies], profile.id).toEqual([]);
      for (const name of [...profile.dependencies, ...profile.devDependencies])
        expect(name, profile.id).toMatch(/^(@[a-z0-9-]+\/)?[a-z0-9.-]+$/);
    }
  });

  it('the catalog wins on stack keys and verification; rules go app → profile → project without duplicates', () => {
    const spa = findStackProfile('web-spa-react')!;
    const proposed: ProjectProfile = {
      objectives: ['Notas'],
      outOfScope: [],
      techStack: { Lenguaje: 'JavaScript', persistencia: 'localStorage' },
      rules: ['Textos al usuario en español.', APP_RULES[0]!],
      verificationCommands: ['npm test'],
    };
    const merged = applyStackProfile(proposed, spa);
    expect(merged.stackProfileId).toBe('web-spa-react');
    expect(merged.techStack).toEqual({ ...spa.techStack, persistencia: 'localStorage' });
    expect(merged.verificationCommands).toEqual(['node_modules/.bin/tsc --noEmit', 'node_modules/.bin/vitest run']);
    expect(merged.rules).toEqual([...APP_RULES, ...spa.rules, 'Textos al usuario en español.']);
  });

  it('the proposal prompt carries the catalog for a new project and the schema only accepts its ids', () => {
    const prompt = buildProposalPrompt(
      { name: 'Notas', description: null, brief: 'Una SPA de notas', rootId: 'root' } as never,
      [],
      [],
    );
    for (const entry of catalogForPrompt()) expect(prompt).toContain(`"id":"${entry.id}"`);
    const operation = (
      proposalSchema.properties.operations as { items: { properties: Record<string, { enum?: string[] }> } }
    ).items.properties;
    expect(operation.stackProfileId!.enum).toEqual(STACK_PROFILES.map(profile => profile.id));
  });

  it('a new project without a known profile is reported; an existing one keeps its own stack and verification', () => {
    const withProfile = (id: string | undefined) =>
      proposal().map(op =>
        op.type === 'SET_PROJECT_PROFILE' ? { ...op, stackProfileId: id } : op,
      ) as ChangeOperation[];
    expect(buildFoundationPlan(withProfile(undefined), 'root').problems.join(' ')).toContain(
      'Falta el perfil de stack',
    );
    expect(buildFoundationPlan(withProfile('rails'), 'root').problems.join(' ')).toContain('«rails» no existe');
    const brownfield = buildFoundationPlan(withProfile('web-spa-react'), 'root', { brownfield: true });
    const profile = brownfield.operations.find(op => op.type === 'SET_PROJECT_PROFILE') as ProjectProfile;
    expect(profile.stackProfileId).toBeUndefined();
    expect(profile.verificationCommands).toEqual(['node --test']);
    expect(brownfield.problems.join(' ')).not.toContain('perfil de stack');
  });
});
