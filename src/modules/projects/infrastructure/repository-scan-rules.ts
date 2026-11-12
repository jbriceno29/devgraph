import { constants } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { type RepositoryScanFileKind } from '../../../shared/contracts/repository-scan.js';

/** Files listed at most (the rest only sets `truncated`). */
export const MAX_LISTED_FILES = 20_000;
/** Bytes of content kept per file, by kind (the whole scan stays within MAX_SCAN_BYTES anyway). */
export const FILE_LIMIT: Record<RepositoryScanFileKind, number> = {
  MANIFEST: 8 * 1024,
  STYLE: 8 * 1024,
  README: 4 * 1024,
  CI: 3 * 1024,
};
/** A large style file is read this far looking for its token lines (custom properties, variables, @theme…). */
export const STYLE_SCAN_BYTES = 256 * 1024;
export const MAX_MANIFESTS = 12,
  MAX_STYLES = 6,
  MAX_CI = 2,
  MAX_DIRECTORIES = 60,
  MAX_TOP_LEVEL = 60;
export const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** Folders of generated or vendored code: never listed even when not ignored. */
export const GENERATED_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  'Pods',
  '.expo',
  '.parcel-cache',
  'coverage',
  'out',
  'bin',
  'obj',
  '.cache',
  '.terraform',
]);
/** Folders that hold credentials. */
export const SECRET_DIRS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.docker',
  '.gcloud',
  '.secrets',
  'secrets',
  'credentials',
]);
export const SECRET_NAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pypirc',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.htpasswd',
  '.pgpass',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'master.key',
  'credentials',
  'known_hosts',
  'authorized_keys',
]);
export const SECRET_EXTENSIONS = [
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
  '.der',
  '.jks',
  '.keystore',
  '.kdbx',
  '.ppk',
  '.asc',
  '.gpg',
  '.ovpn',
  '.tfstate',
  '.tfvars',
  '.mobileprovision',
];

/** Whether a repository path looks like it holds a secret (checked on every component; such files are never opened). */
export function isSensitivePath(relativePath: string): boolean {
  const parts = relativePath.toLowerCase().split('/');
  if (parts.slice(0, -1).some(part => SECRET_DIRS.has(part))) return true;
  const name = parts.at(-1) ?? '';
  return (
    SECRET_NAMES.has(name) ||
    name.startsWith('.env.') ||
    name.startsWith('id_rsa') ||
    name.startsWith('id_ed25519') ||
    name.startsWith('id_ecdsa') ||
    /secret|credential|password|passwd|service[-_]?account|private[-_]?key/.test(name) ||
    SECRET_EXTENSIONS.some(extension => name.endsWith(extension))
  );
}
/** A path relative to the repository: not empty, not absolute, only normal components (no `.`, `..`, empty parts, backslashes or NUL). */
export function isSafeRelativePath(relativePath: string): boolean {
  if (
    !relativePath ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath)
  )
    return false;
  return relativePath.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export const LANGUAGES: Record<string, string> = {
  rs: 'Rust',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  swift: 'Swift',
  dart: 'Dart',
  html: 'HTML',
  css: 'CSS',
  scss: 'CSS',
  sass: 'CSS',
  less: 'CSS',
  json: 'JSON',
  toml: 'TOML',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  mdx: 'Markdown',
  sql: 'SQL',
  sh: 'Shell',
  c: 'C',
  h: 'C',
  cc: 'C++',
  cpp: 'C++',
  hpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  rb: 'Ruby',
  ex: 'Elixir',
  exs: 'Elixir',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
};
export const extensionOf = (name: string) =>
  name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';

export const MANIFEST_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'deno.json',
  'deno.jsonc',
  'bunfig.toml',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'setup.cfg',
  'pipfile',
  'go.mod',
  'gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'pubspec.yaml',
  'mix.exs',
  'package.swift',
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  'docker-compose.yml',
  'compose.yaml',
  'angular.json',
  'components.json',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.tool-versions',
  'tauri.conf.json',
]);
export const BUILD_CONFIG =
  /^(?:vite|vitest|next|nuxt|astro|svelte|remix|webpack|rollup|jest|playwright|eslint\.config)\.config\.(?:js|mjs|cjs|ts|mts)$|^eslint\.config\.(?:js|mjs|cjs|ts)$/;
export const STYLE_EXT = /\.(?:css|scss|sass|less)$/;
export const TOKEN_NAME = /(?:^|[-_.])(?:design[-_]?)?tokens?(?:[-_.]|$)|theme|variables|palette|colou?rs?(?:[-_.]|$)/;
export const GLOBAL_STYLE = /^(?:globals?|index|main|app|styles?|base|tailwind|theme)\.(?:css|scss|sass|less)$/;

/** Rank of a candidate style file (lower first) or null when it is not one. Token/theme files and the Tailwind config say most about a design system. */
export function styleRank(path: string): number | null {
  const name = basename(path).toLowerCase();
  if (name.endsWith('.min.css')) return null;
  if (/^tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(name)) return 0;
  if (TOKEN_NAME.test(name) && (STYLE_EXT.test(name) || /\.(?:json|js|ts|mjs|cjs)$/.test(name))) return 1;
  if (GLOBAL_STYLE.test(name)) return 2;
  if (/^postcss\.config\.(?:js|cjs|mjs|ts)$/.test(name)) return 3;
  if (STYLE_EXT.test(name)) return 4;
  return null;
}

/** Values that look like secrets are replaced, even inside files that are allowed (a token pasted into a config, a URL with a password). */
export const KNOWN_SECRETS =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,})/g;
export const NAMED_SECRET =
  /((?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?key|auth[_-]?token)[\w.-]*["']?\s*[:=]\s*["']?)([^\s"',;}{)]{16,})/gi;
export const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi;
export function redactSecrets(text: string): string {
  return text
    .replace(KNOWN_SECRETS, '[REDACTADO]')
    .replace(NAMED_SECRET, (_match, key: string) => `${key}[REDACTADO]`)
    .replace(URL_CREDENTIALS, (_match, scheme: string) => `${scheme}[REDACTADO]@`);
}

export const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');
/** Cuts a string to at most `bytes` UTF-8 bytes without splitting a character. */
export const cutBytes = (value: string, bytes: number) => {
  if (byteLength(value) <= bytes) return value;
  let out = Buffer.from(value, 'utf8').subarray(0, Math.max(0, bytes)).toString('utf8');
  while (out.endsWith('\uFFFD')) out = out.slice(0, -1);
  return out;
};
/** The lines of a style file that define its design system. */
export const TOKEN_LINE =
  /--[\w-]+\s*:|^\s*\$[\w-]+\s*:|@theme|@tailwind|@import|@layer|@font-face|font-family|:root|\[data-theme|prefers-color-scheme|^\s*@?[\w-]*colou?rs?\s*[:=]/i;
