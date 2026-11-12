import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { checkArchitecture, importViolation, measure } from '../../scripts/check-architecture.mjs';

describe('reglas de arquitectura (docs/PROPUESTA_ARQUITECTURA.md §5)', () => {
  it('src/ has no new or grown violations over the baseline (npm run check:arch for the detail)', () => {
    const { violations } = checkArchitecture();
    expect(violations.map((v: { rule: string; file: string }) => `${v.rule} ${v.file}`)).toEqual([]);
  });
  it('enforces the direction of dependencies and module boundaries', () => {
    expect(importViolation('src/domain/a.ts', 'src/shared/contracts/x.ts')).toMatch(/domain solo importa/);
    expect(importViolation('src/domain/a.ts', 'node:crypto')).toMatch(/recibe un puerto/);
    expect(importViolation('src/domain/a.ts', 'src/shared/kernel/x.ts')).toBeNull();
    expect(importViolation('src/application/a.ts', 'src/infrastructure/x.ts')).toMatch(/no importa infraestructura/);
    expect(importViolation('src/application/a.ts', 'src/domain/x.ts')).toBeNull();
    expect(importViolation('src/shared/contracts/a.ts', 'src/application/x.ts')).toMatch(/solo importa shared/);
    expect(importViolation('src/desktop/a.tsx', 'src/domain/x.ts')).toMatch(/desktop solo importa/);
    expect(importViolation('src/desktop/a.tsx', 'react')).toBeNull();
    expect(importViolation('src/modules/a/application/x.ts', 'src/modules/b/domain/y.ts')).toMatch(/index\.ts/);
    expect(importViolation('src/modules/a/application/x.ts', 'src/modules/b/index.ts')).toBeNull();
    expect(importViolation('src/modules/a/domain/x.ts', 'src/modules/a/infrastructure/y.ts')).toMatch(/domain/);
  });
  it('measures size, long functions, long texts, misplaced SQL and direct IPC access', () => {
    const body = Array.from({ length: 70 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const text = [
      `export function big() {\n${body}\n}`,
      `export const prompt = '${'x'.repeat(450)}';`,
      `export const q = (db: any) => db.prepare('SELECT 1').get();`,
      `export const ipc = () => window.workspaceIpc.queries;`,
    ].join('\n');
    const { values } = measure('src/desktop/presentation/a.ts', text);
    expect(values).toMatchObject({ 'function-size': 12, 'long-string': 1, sql: 1, 'ipc-access': 1 });
    expect(measure('src/desktop/features/plan/plan.api.ts', text).values['ipc-access']).toBeUndefined();
    expect(measure('src/infrastructure/persistence/x.ts', text).values.sql).toBeUndefined();
  });
});
