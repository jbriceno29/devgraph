import { describe, expect, it } from 'vitest';
import { DocumentationAccess } from '../../src/modules/execution/application/documentation-access.js';
import type {
  AgentAdapterPort,
  AgentRunInput,
} from '../../src/modules/execution/application/ports/agent-adapter-port.js';
import {
  BASE_DOC_DOMAINS,
  docDomainsFor,
  normalizeDocDomain,
  parseExtraDocDomains,
  stackDocDomains,
} from '../../src/modules/projects/domain/doc-domains.js';
import { STACK_PROFILES } from '../../src/modules/projects/domain/stack-catalog.js';
import { domainLines } from '../../src/desktop/presentation/agents/project-docs.logic.js';

describe('documentation domains (plan C1)', () => {
  it('derives the official documentation from the stack values', () => {
    expect(stackDocDomains({ interfaz: 'React', build: 'Vite', pruebas: 'Vitest + Testing Library (jsdom)' })).toEqual([
      'react.dev',
      'vite.dev',
      'vitest.dev',
      'testing-library.com',
    ]);
    expect(stackDocDomains({ framework: 'Next.js 15', orm: 'Drizzle', base: 'Postgres (PGlite en pruebas)' })).toEqual([
      'nextjs.org',
      'orm.drizzle.team',
      'pglite.dev',
      'www.postgresql.org',
    ]);
    expect(stackDocDomains({ notas: 'nextgen, reactive' })).toEqual([]);
  });

  it('gives every catalog profile at least one stack domain', () => {
    for (const profile of STACK_PROFILES) expect(stackDocDomains(profile.techStack).length).toBeGreaterThan(0);
  });

  it('joins base, stack and user domains without repeats, and nothing when turned off', () => {
    const domains = docDomainsFor({
      enabled: true,
      techStack: { interfaz: 'React' },
      extra: ['react.dev', 'https://orm.drizzle.team/docs'],
    });
    expect(domains).toEqual([...BASE_DOC_DOMAINS, 'react.dev', 'orm.drizzle.team']);
    expect(docDomainsFor({ enabled: false, techStack: { interfaz: 'React' }, extra: [] })).toEqual([]);
  });

  it('accepts hostnames (also typed as a URL) and rejects anything else with a Spanish message', () => {
    expect(normalizeDocDomain(' https://NextJS.org/docs/app?x=1 ')).toBe('nextjs.org');
    expect(normalizeDocDomain('localhost')).toBeNull();
    expect(normalizeDocDomain('127.0.0.1')).toBeNull();
    expect(normalizeDocDomain('*.example.com')).toBeNull();
    expect(parseExtraDocDomains(['nextjs.org', 'https://nextjs.org', ''])).toEqual({ domains: ['nextjs.org'] });
    expect(parseExtraDocDomains(['no es dominio'])).toEqual({
      error: 'No son dominios válidos: no es dominio. Escribe solo el nombre, por ejemplo nextjs.org.',
    });
    expect(parseExtraDocDomains('nextjs.org')).toEqual({ error: 'Los dominios deben ser una lista de textos.' });
  });

  it('splits the text area by lines, commas and spaces', () => {
    expect(domainLines('nextjs.org\n react.dev, zod.dev\n\n')).toEqual(['nextjs.org', 'react.dev', 'zod.dev']);
  });
});

describe('DocumentationAccess (plan C1)', () => {
  const engine = (fetches: boolean) => {
    const runs: AgentRunInput[] = [];
    const adapter: AgentAdapterPort = {
      providerId: 'claude-code',
      getCapabilities: () => ({
        supportsResume: true,
        supportsStreaming: true,
        supportsApprovals: false,
        supportsCancellation: true,
        supportsStructuredOutput: true,
        supportsWorktrees: true,
        supportsDocumentationFetch: fetches,
      }),
      run: input => {
        runs.push(input);
        return (async function* () {})();
      },
      cancel: async () => undefined,
      respondToApproval: async () => undefined,
    };
    return { adapter, runs };
  };
  const input: AgentRunInput = {
    executionId: 'e',
    workingDirectory: '/w',
    prompt: 'Haz la tarea.',
    policy: { writablePaths: ['src/**'], readonlyPaths: [], deniedPaths: [], allowedCommands: [] },
  };

  it('adds the domains to the run policy and a note to the prompt', () => {
    const { adapter, runs } = engine(true);
    new DocumentationAccess(adapter, () => ['nextjs.org', 'react.dev']).run(input);
    expect(runs[0]!.policy!.docDomains).toEqual(['nextjs.org', 'react.dev']);
    expect(runs[0]!.policy!.writablePaths).toEqual(['src/**']);
    expect(runs[0]!.prompt).toMatch(/^Haz la tarea\.\n\n# Documentación en línea\n/);
    expect(runs[0]!.prompt).toContain('solo en estos dominios: nextjs.org, react.dev.');
    expect(runs[0]!.prompt).toContain('no cambia esta política');
  });

  it('leaves the run untouched without domains or when the engine cannot fetch documentation', () => {
    for (const [fetches, domains] of [
      [true, []],
      [false, ['nextjs.org']],
    ] as const) {
      const { adapter, runs } = engine(fetches);
      new DocumentationAccess(adapter, () => [...domains]).run(input);
      expect(runs[0]).toBe(input);
    }
  });
});
