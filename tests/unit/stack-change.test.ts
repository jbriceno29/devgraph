import { describe, expect, it } from 'vitest';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import { stackChangeRule, withCatalogProfile } from '../../src/modules/planning/application/stack-change.js';
import {
  buildPlannerPrompt,
  normalizeOperation,
  plainSchema,
  strictNullableSchema,
} from '../../src/modules/planning/infrastructure/change-set-planning-contract.js';
import { APP_RULES, findStackProfile } from '../../src/modules/projects/domain/stack-catalog.js';

const spa = findStackProfile('web-spa-react')!,
  next = findStackProfile('web-nextjs')!;

describe('stack change through the planner (plan C7a)', () => {
  it('the planner prompt carries the catalog, Next.js included, and asks for it only on a stack change', () => {
    const prompt = buildPlannerPrompt({
      prompt: 'Migra a Next.js',
      project: { name: 'Tienda', description: null, rules: [], revision: 1 },
      focusEntity: null,
      entities: [],
      relationships: [],
    } as never);
    expect(prompt).toContain(stackChangeRule());
    expect(prompt).toContain('"id":"web-nextjs"');
    expect(prompt).toContain('only if the request asks to change the stack');
  });

  it('completes the proposed profile with the catalog and drops the rules the old profile brought', () => {
    const proposed: ChangeOperation = {
      type: 'SET_PROJECT_PROFILE',
      stackProfileId: 'web-nextjs',
      objectives: ['Vender en línea'],
      outOfScope: ['Pagos reales'],
      techStack: { lenguaje: 'JavaScript', pagos: 'Stripe (modo de prueba)' },
      rules: [...APP_RULES, ...spa.rules, 'Textos al usuario en español.'],
      verificationCommands: ['npm test'],
    };
    const merged = withCatalogProfile(proposed);
    expect(merged).toMatchObject({
      type: 'SET_PROJECT_PROFILE',
      stackProfileId: 'web-nextjs',
      objectives: ['Vender en línea'],
      outOfScope: ['Pagos reales'],
      techStack: { ...next.techStack, pagos: 'Stripe (modo de prueba)' },
      rules: [...APP_RULES, ...next.rules, 'Textos al usuario en español.'],
      verificationCommands: [...next.verificationCommands],
    });
    expect(withCatalogProfile(merged)).toEqual(merged);
  });

  it('leaves other operations and profiles outside the catalog untouched', () => {
    const status: ChangeOperation = { type: 'UPDATE_ENTITY_STATUS', entityId: 'x', newStatus: 'ARCHIVED', reason: 'r' };
    expect(withCatalogProfile(status)).toBe(status);
    const own: ChangeOperation = {
      type: 'SET_PROJECT_PROFILE',
      objectives: ['x'],
      outOfScope: [],
      techStack: { lenguaje: 'Go' },
      rules: [],
      verificationCommands: ['go test ./...'],
    };
    expect(withCatalogProfile(own)).toBe(own);
  });
});

describe('the planner lists a profile change with its stack (plan C7a)', () => {
  it('shows the stack and checks next to «Definir el perfil del proyecto»', async () => {
    const { describeOperation, operationDetail } = await import(
      '../../src/desktop/presentation/planning/operation-summary.logic.js'
    );
    const operation = withCatalogProfile({
      type: 'SET_PROJECT_PROFILE',
      stackProfileId: 'web-nextjs',
      objectives: ['x'],
      outOfScope: [],
      techStack: {},
      rules: [],
      verificationCommands: [],
    }) as unknown as Record<string, unknown>;
    expect(describeOperation(operation)).toBe('Definir el perfil del proyecto');
    expect(operationDetail(operation)).toContain('Stack: TypeScript, Next.js (App Router), React, Tailwind CSS 4');
    expect(operationDetail(operation)).toContain('Comprobaciones: node_modules/.bin/tsc --noEmit');
    expect(operationDetail({ type: 'CREATE_FEATURE', title: 'Carrito' })).toBe('Carrito');
    expect(operationDetail({ type: 'DELETE_RELATIONSHIP' })).toBeNull();
  });
});

describe('the planner output accepts a profile change (plan C7a)', () => {
  it('both schemas offer SET_PROJECT_PROFILE with the catalog ids, and techStack pairs become a record', () => {
    const plain = plainSchema.properties.operations.items.properties as Record<string, { enum?: unknown[] }>;
    expect(plain.type!.enum).toContain('SET_PROJECT_PROFILE');
    expect(plain.stackProfileId!.enum).toContain('web-nextjs');
    const strict = strictNullableSchema.properties.operations.items;
    expect(strict.required).toEqual(expect.arrayContaining(['stackProfileId', 'techStack', 'verificationCommands']));
    expect(
      normalizeOperation({
        type: 'SET_PROJECT_PROFILE',
        stackProfileId: 'web-nextjs',
        objectives: ['Vender'],
        outOfScope: null,
        techStack: [{ key: 'pagos', value: 'Stripe' }],
        rules: null,
        verificationCommands: null,
      }),
    ).toEqual({
      type: 'SET_PROJECT_PROFILE',
      stackProfileId: 'web-nextjs',
      objectives: ['Vender'],
      outOfScope: [],
      techStack: { pagos: 'Stripe' },
      rules: [],
      verificationCommands: [],
    });
  });
});
