import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceCore } from '../../src/bootstrap/workspace-core.js';
import type { ProjectDocsDto } from '../../src/shared/contracts/project-docs.js';

const roots: string[] = [];
const cores: Array<ReturnType<typeof createWorkspaceCore>> = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'graphdev-docs-'));
  roots.push(root);
  const core = createWorkspaceCore(join(root, 'workspace'), () => undefined, {});
  cores.push(core);
  const created = (await core.handle({ channel: 'project:create', args: [{ name: 'Tienda', slug: 'tienda' }] })) as {
    id: string;
  };
  return { core, id: created.id };
}

describe('Ajustes › Documentación en línea (plan C1)', () => {
  it('is on by default with the base domains, keeps the user domains normalized and can be turned off', async () => {
    const { core, id } = await project();
    const initial = (await core.handle({ channel: 'project:docs', args: [id] })) as ProjectDocsDto;
    expect(initial).toEqual({
      enabled: true,
      domains: ['developer.mozilla.org', 'www.npmjs.com'],
      stackDomains: ['developer.mozilla.org', 'www.npmjs.com'],
      extraDomains: [],
    });
    const saved = (await core.handle({
      channel: 'project:set_docs',
      args: [id, { enabled: true, extraDomains: ['https://orm.drizzle.team/docs', 'nextjs.org'] }],
    })) as ProjectDocsDto;
    expect(saved.extraDomains).toEqual(['orm.drizzle.team', 'nextjs.org']);
    expect(saved.domains).toEqual(['developer.mozilla.org', 'www.npmjs.com', 'orm.drizzle.team', 'nextjs.org']);
    const off = (await core.handle({
      channel: 'project:set_docs',
      args: [id, { enabled: false, extraDomains: saved.extraDomains }],
    })) as ProjectDocsDto;
    expect(off.domains).toEqual([]);
    expect(off.extraDomains).toEqual(['orm.drizzle.team', 'nextjs.org']);
  });

  it('refuses domains that are not hostnames and saves nothing', async () => {
    const { core, id } = await project();
    await expect(
      core.handle({ channel: 'project:set_docs', args: [id, { enabled: true, extraDomains: ['localhost'] }] }),
    ).rejects.toThrow('No son dominios válidos: localhost.');
    expect(((await core.handle({ channel: 'project:docs', args: [id] })) as ProjectDocsDto).extraDomains).toEqual([]);
  });
});
