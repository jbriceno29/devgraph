import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type { ChangeOperation } from '../../src/modules/knowledge/domain/change-set.js';
import { findStackProfile } from '../../src/modules/projects/domain/stack-catalog.js';
import type { ProjectDocsDto } from '../../src/shared/contracts/project-docs.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const toNext: ChangeOperation = {
  type: 'SET_PROJECT_PROFILE',
  stackProfileId: 'web-nextjs',
  objectives: ['Vender en línea'],
  outOfScope: [],
  techStack: { lenguaje: 'TypeScript' },
  rules: ['Textos al usuario en español.'],
  verificationCommands: ['npm test'],
};

describe('changing the stack of a project under way (plan C7a)', () => {
  it('is a proposal that always asks; once approved the project follows the Next.js profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'graphdev-stack-'));
    roots.push(root);
    const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, {
      changeSetPlanner: {
        propose: async () => ({ title: 'Migrar a Next.js', rationale: 'El usuario lo pidió.', operations: [toNext] }),
      },
    });
    cores.push(core);
    const project = (await core.handle({ channel: 'project:create', args: [{ name: 'Tienda', slug: 'tienda' }] })) as {
      id: string;
    };
    const changeSet = (await core.handle({
      channel: 'changeset:propose_from_chat',
      args: [project.id, 'Migra el proyecto a Next.js'],
    })) as { id: string; status: string; operations: ChangeOperation[] };
    const next = findStackProfile('web-nextjs')!;
    expect(changeSet.status).toBe('VALIDATED');
    expect(changeSet.operations[0]).toMatchObject({
      stackProfileId: 'web-nextjs',
      verificationCommands: [...next.verificationCommands],
    });
    expect((changeSet.operations[0] as { rules: string[] }).rules).toEqual(
      expect.arrayContaining([...next.rules, 'Textos al usuario en español.']),
    );
    await core.handle({ channel: 'changeset:apply', args: [changeSet.id] });
    const policy = (await core.handle({ channel: 'policy:get', args: [project.id] })) as {
      allowedCommands: string[];
      writablePaths: string[];
    };
    expect(policy.allowedCommands).toEqual([...next.verificationCommands]);
    expect(policy.writablePaths).toEqual(expect.arrayContaining(['next.config.ts', 'postcss.config.mjs', 'public/**']));
    const environment = (await core.handle({ channel: 'environment:get', args: [project.id] })) as {
      stackProfile: { id: string; packages: string[] };
    };
    expect(environment.stackProfile.id).toBe('web-nextjs');
    expect(environment.stackProfile.packages).toEqual(expect.arrayContaining(['next', '@electric-sql/pglite']));
    const docs = (await core.handle({ channel: 'project:docs', args: [project.id] })) as ProjectDocsDto;
    expect(docs.domains).toEqual(
      expect.arrayContaining(['nextjs.org', 'react.dev', 'tailwindcss.com', 'orm.drizzle.team', 'pglite.dev']),
    );
  });
});
