/**
 * Plan C1: where agents may read current documentation. The app derives the domains from the project's stack (the
 * catalog profile or what an existing repository declares) and the user adds their own per project. Only read access:
 * the engine fetches pages, and what it reads is reference, never instructions.
 */

/** Every project with documentation on gets these: the web platform and the package registry. */
export const BASE_DOC_DOMAINS: readonly string[] = ['developer.mozilla.org', 'www.npmjs.com'];

/** Official documentation by technology, matched against the stack's values (case-insensitive, whole words). */
const BY_TECHNOLOGY: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\bnext(?:\.js)?\b/i, ['nextjs.org']],
  [/\breact\b/i, ['react.dev']],
  [/\bvite\b/i, ['vite.dev']],
  [/\bvitest\b/i, ['vitest.dev']],
  [/\btesting library\b/i, ['testing-library.com']],
  [/\bplaywright\b/i, ['playwright.dev']],
  [/\btypescript\b/i, ['www.typescriptlang.org']],
  [/\bnode(?:\.js)?\b|\bnode:test\b/i, ['nodejs.org']],
  [/\btailwind(?:\s*css)?\b/i, ['tailwindcss.com']],
  [/\bfastify\b/i, ['fastify.dev']],
  [/\bexpress\b/i, ['expressjs.com']],
  [/\bzod\b/i, ['zod.dev']],
  [/\bdrizzle\b/i, ['orm.drizzle.team']],
  [/\bprisma\b/i, ['www.prisma.io']],
  [/\bpglite\b/i, ['pglite.dev']],
  [/\bpostgres(?:ql)?\b/i, ['www.postgresql.org']],
  [/\bsupabase\b/i, ['supabase.com']],
  [/\bstripe\b/i, ['docs.stripe.com']],
  [/\bpython\b|\bunittest\b/i, ['docs.python.org']],
];

/** At most this many domains reach a run: each one is a permission rule and a line of the prompt. */
export const MAX_DOC_DOMAINS = 30;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The hostname of what the user typed (`https://nextjs.org/docs` gives `nextjs.org`), or null when it is not one. */
export function normalizeDocDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  return HOSTNAME.test(host) ? host : null;
}

/** The domains the stack suggests, from its values (for example {"interfaz": "React"} gives react.dev). */
export function stackDocDomains(techStack: Record<string, unknown>): string[] {
  const text = Object.values(techStack)
    .filter((value): value is string => typeof value === 'string')
    .join(' · ');
  return BY_TECHNOLOGY.filter(([pattern]) => pattern.test(text)).flatMap(([, domains]) => domains);
}

/** Every domain a run of the project may read: base, stack and the user's own, without repeats and within the limit. */
export function docDomainsFor(input: {
  enabled: boolean;
  techStack: Record<string, unknown>;
  extra: string[];
}): string[] {
  if (!input.enabled) return [];
  const extra = input.extra.map(normalizeDocDomain).filter((domain): domain is string => domain !== null);
  return [...new Set([...BASE_DOC_DOMAINS, ...stackDocDomains(input.techStack), ...extra])].slice(0, MAX_DOC_DOMAINS);
}

/** Validates the user's domains: the normalized list, or the Spanish error to show. */
export function parseExtraDocDomains(value: unknown): { domains: string[] } | { error: string } {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    return { error: 'Los dominios deben ser una lista de textos.' };
  const typed = value.map(item => item.trim()).filter(Boolean);
  const invalid = typed.filter(item => normalizeDocDomain(item) === null);
  if (invalid.length)
    return {
      error: `No son dominios válidos: ${invalid.join(', ')}. Escribe solo el nombre, por ejemplo nextjs.org.`,
    };
  const domains = [...new Set(typed.map(item => normalizeDocDomain(item) as string))];
  if (domains.length > MAX_DOC_DOMAINS) return { error: `Puedes añadir como mucho ${MAX_DOC_DOMAINS} dominios.` };
  return { domains };
}
