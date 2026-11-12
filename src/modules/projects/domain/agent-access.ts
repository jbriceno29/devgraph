/**
 * R1 of docs/PLAN_REPOSITORIO_EXISTENTE.md: what the agent may write in a repository that already has code, and which
 * checks verify its work, derived from the scan without a model. A new project keeps the default `src/`, `tests/` and
 * `docs/`; an existing one gets the folders it really has (`app/`, `components/`, `lib/`…) so its work is not reverted.
 */
export interface RepositoryLayout {
  /** Root entries; folders end with `/`. */
  topLevel: readonly string[];
  /** Content of the root package.json, if it was read. */
  packageJson: string | null;
}
export type AccessReason = 'CODE' | 'TESTS' | 'CONFIG' | 'DOCS' | 'GENERATED';
export interface WritablePath {
  pattern: string;
  reason: AccessReason;
}
export interface AgentAccessProposal {
  writable: WritablePath[];
  verificationCommands: string[];
}

/** Outputs the app itself creates in a run's worktree (installs, builds, coverage): writing them is never a violation. */
export const GENERATED_OUTPUTS = ['node_modules/**', 'dist/**', 'target/**', 'coverage/**'] as const;
/** Root folders that are not the project's code: documentation (docs/ is written by the app), tooling, CI and outputs. */
const NOT_CODE = new Set([
  'docs',
  '.git',
  '.github',
  '.gitlab',
  '.vscode',
  '.idea',
  '.husky',
  '.claude',
  '.devcontainer',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'vendor',
]);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'cypress', 'playwright']);
/** Root files the stack needs to touch (manifest, compiler and tool configuration, documentation entry points). */
const CONFIG_FILE =
  /^(package\.json|tsconfig(\.[\w-]+)?\.json|jsconfig\.json|(vite|vitest|next|nuxt|svelte|astro|tailwind|postcss|eslint|prettier|jest|playwright|webpack|rollup|babel|remix|drizzle|turbo)\.config\.(js|cjs|mjs|ts|cts|mts|json)|\.eslintrc(\.\w+)?|\.prettierrc(\.\w+)?|biome\.jsonc?|index\.html|README\.md|\.gitignore|pyproject\.toml|requirements(-dev)?\.txt|Cargo\.toml|go\.mod)$/;
/** The order in which existing scripts become checks: tests first, then what catches errors without running the app. */
const CHECK_SCRIPTS = ['test', 'typecheck', 'lint', 'build'] as const;
/** npm's placeholder test script fails on purpose: it is not a check. */
const PLACEHOLDER = /no test specified/i;

export function proposeAgentAccess(layout: RepositoryLayout): AgentAccessProposal {
  const writable: WritablePath[] = [];
  for (const entry of layout.topLevel) {
    if (entry.endsWith('/')) {
      const name = entry.slice(0, -1);
      if (NOT_CODE.has(name) || name.startsWith('.')) continue;
      writable.push({ pattern: `${name}/**`, reason: TEST_DIRS.has(name) ? 'TESTS' : 'CODE' });
    } else if (CONFIG_FILE.test(entry)) writable.push({ pattern: entry, reason: 'CONFIG' });
  }
  // docs/ is not code, but tasks document there (the ADRs stay read-only in the policy).
  writable.push({ pattern: 'docs/**', reason: 'DOCS' });
  for (const pattern of GENERATED_OUTPUTS) writable.push({ pattern, reason: 'GENERATED' });
  return { writable, verificationCommands: checkCommands(layout) };
}

function checkCommands(layout: RepositoryLayout): string[] {
  let scripts: Record<string, unknown> = {};
  try {
    const manifest = JSON.parse(layout.packageJson ?? '{}') as { scripts?: unknown };
    if (manifest.scripts && typeof manifest.scripts === 'object') scripts = manifest.scripts as Record<string, unknown>;
  } catch {
    return [];
  }
  const runner = layout.topLevel.includes('pnpm-lock.yaml') ? 'pnpm' : 'npm';
  return CHECK_SCRIPTS.filter(
    name => typeof scripts[name] === 'string' && !PLACEHOLDER.test(String(scripts[name])),
  ).map(name => (name === 'test' ? `${runner} test` : `${runner} run ${name}`));
}

/** A path pattern the user typed for the policy: relative, inside the repository, no shell or parent segments. */
export function writablePathIssue(pattern: string): string | null {
  const value = pattern.trim();
  if (!value) return 'La ruta está vacía.';
  if (value.length > 200) return `La ruta ${value.slice(0, 40)}… es demasiado larga.`;
  if (value.startsWith('/') || /^[a-z]:/i.test(value)) return `La ruta ${value} debe ser relativa al repositorio.`;
  if (value.split('/').includes('..')) return `La ruta ${value} no puede salir del repositorio.`;
  if (/^\.git(\/|$)/.test(value) || /^\.env/.test(value)) return `La ruta ${value} está prohibida para el agente.`;
  if (/[;&|`$<>\n\r"']/.test(value)) return `La ruta ${value} tiene caracteres no permitidos.`;
  return null;
}
