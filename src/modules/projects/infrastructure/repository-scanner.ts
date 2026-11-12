import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import type { RepositoryScannerPort } from '../application/ports/repository-scan-port.js';
import {
  MAX_SCAN_BYTES,
  type RepositoryScanDto,
  type RepositoryScanFileDto,
  type RepositoryScanFileKind,
} from '../../../shared/contracts/repository-scan.js';
import { pinnedGit } from './git-repository-initializer.js';

/** Files listed at most (the rest only sets `truncated`). */
export const MAX_LISTED_FILES = 20_000;
/** Bytes of content kept per file, by kind (the whole scan stays within MAX_SCAN_BYTES anyway). */
const FILE_LIMIT: Record<RepositoryScanFileKind, number> = {
  MANIFEST: 8 * 1024,
  STYLE: 8 * 1024,
  README: 4 * 1024,
  CI: 3 * 1024,
};
/** A large style file is read this far looking for its token lines (custom properties, variables, @theme…). */
const STYLE_SCAN_BYTES = 256 * 1024;
const MAX_MANIFESTS = 12,
  MAX_STYLES = 6,
  MAX_CI = 2,
  MAX_DIRECTORIES = 60,
  MAX_TOP_LEVEL = 60;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** Folders of generated or vendored code: never listed even when not ignored. */
const GENERATED_DIRS = new Set([
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
const SECRET_DIRS = new Set([
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
const SECRET_NAMES = new Set([
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
const SECRET_EXTENSIONS = [
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

const LANGUAGES: Record<string, string> = {
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
const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

const MANIFEST_NAMES = new Set([
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
const BUILD_CONFIG =
  /^(?:vite|vitest|next|nuxt|astro|svelte|remix|webpack|rollup|jest|playwright|eslint\.config)\.config\.(?:js|mjs|cjs|ts|mts)$|^eslint\.config\.(?:js|mjs|cjs|ts)$/;
const STYLE_EXT = /\.(?:css|scss|sass|less)$/;
const TOKEN_NAME = /(?:^|[-_.])(?:design[-_]?)?tokens?(?:[-_.]|$)|theme|variables|palette|colou?rs?(?:[-_.]|$)/;
const GLOBAL_STYLE = /^(?:globals?|index|main|app|styles?|base|tailwind|theme)\.(?:css|scss|sass|less)$/;

/** Rank of a candidate style file (lower first) or null when it is not one. Token/theme files and the Tailwind config say most about a design system. */
function styleRank(path: string): number | null {
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
const KNOWN_SECRETS =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,})/g;
const NAMED_SECRET =
  /((?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?key|auth[_-]?token)[\w.-]*["']?\s*[:=]\s*["']?)([^\s"',;}{)]{16,})/gi;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi;
export function redactSecrets(text: string): string {
  return text
    .replace(KNOWN_SECRETS, '[REDACTADO]')
    .replace(NAMED_SECRET, (_match, key: string) => `${key}[REDACTADO]`)
    .replace(URL_CREDENTIALS, (_match, scheme: string) => `${scheme}[REDACTADO]@`);
}

const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');
/** Cuts a string to at most `bytes` UTF-8 bytes without splitting a character. */
const cutBytes = (value: string, bytes: number) => {
  if (byteLength(value) <= bytes) return value;
  let out = Buffer.from(value, 'utf8').subarray(0, Math.max(0, bytes)).toString('utf8');
  while (out.endsWith('\uFFFD')) out = out.slice(0, -1);
  return out;
};
/** The lines of a style file that define its design system. */
const TOKEN_LINE =
  /--[\w-]+\s*:|^\s*\$[\w-]+\s*:|@theme|@tailwind|@import|@layer|@font-face|font-family|:root|\[data-theme|prefers-color-scheme|^\s*@?[\w-]*colou?rs?\s*[:=]/i;

/**
 * Brownfield scan (Etapa E of the inception proposal, ported from the earlier `repository_scan.rs`). `git ls-files` decides what exists, so
 * `.gitignore` (and `.git/info/exclude`) are respected exactly as git does, with git pinned to ignore system and global configuration and with
 * fsmonitor off (no program from the repository's config runs). Then, on top: generated folders, credential-like paths and anything that is,
 * or goes through, a symbolic link are left out; contents are opened with O_NOFOLLOW only after checking that the real path is the lexical
 * one inside the repository; binary files are skipped; values that look like secrets are redacted; and the serialized result never
 * exceeds MAX_SCAN_BYTES. Nothing is executed and nothing is written.
 */
export class GitRepositoryScanner implements RepositoryScannerPort {
  constructor(private readonly limits: { maxFiles?: number; maxBytes?: number } = {}) {}

  async scan(repositoryPath: string): Promise<RepositoryScanDto> {
    const input = String(repositoryPath ?? '');
    if (!input || input.includes('\0') || !isAbsolute(input))
      throw new Error('La ruta del repositorio debe ser absoluta.');
    if (input.split(/[\\/]+/).some(part => part === '..'))
      throw new Error('La ruta del repositorio no puede contener «..».');
    const root = await realpath(normalize(input)).catch(() => {
      throw new Error(`No se encuentra el repositorio: ${input}`);
    });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory()) throw new Error('La ruta del repositorio no es una carpeta.');
    const maxFiles = this.limits.maxFiles ?? MAX_LISTED_FILES,
      maxBytes = this.limits.maxBytes ?? MAX_SCAN_BYTES;
    const git = (args: string[]) =>
      pinnedGit(root, ['-c', 'core.untrackedCache=false', '-c', 'core.quotePath=false', ...args], {
        maxBuffer: 64 * 1024 * 1024,
      }).catch((error: unknown) => {
        throw new Error(
          `No se pudo listar el repositorio con git (¿es un repositorio Git?): ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        );
      });
    const split = (output: string) => output.split('\0').filter(Boolean);
    const listed = [...new Set(split(await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])))];
    // Tracked files that match an ignore rule are left out too: the user said they do not belong to the project.
    const ignoredTracked = new Set(split(await git(['ls-files', '-z', '--cached', '--ignored', '--exclude-standard'])));
    const ignoredOthers = split(
      await git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']),
    ).length;

    const excluded = { ignored: ignoredOthers, generated: 0, symlinks: 0, secrets: 0 };
    const warnings: string[] = [];
    const linkedDirs = new Map<string, boolean>();
    const throughLink = async (parts: string[]) => {
      for (let depth = 1; depth < parts.length; depth++) {
        const dir = parts.slice(0, depth).join('/');
        let linked = linkedDirs.get(dir);
        if (linked === undefined) {
          const info = await lstat(join(root, ...parts.slice(0, depth))).catch(() => null);
          linked = !info || info.isSymbolicLink() || !info.isDirectory();
          linkedDirs.set(dir, linked);
        }
        if (linked) return true;
      }
      return false;
    };
    const files: Array<{ path: string; size: number }> = [];
    let truncated = false,
      unsafe = 0;
    for (const path of listed.sort()) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      if (!isSafeRelativePath(path)) {
        unsafe++;
        continue;
      }
      if (ignoredTracked.has(path)) {
        excluded.ignored++;
        continue;
      }
      const parts = path.split('/');
      if (parts.slice(0, -1).some(part => GENERATED_DIRS.has(part))) {
        excluded.generated++;
        continue;
      }
      if (isSensitivePath(path)) {
        excluded.secrets++;
        continue;
      }
      if (await throughLink(parts)) {
        excluded.symlinks++;
        continue;
      }
      const info = await lstat(join(root, ...parts)).catch(() => null);
      if (!info) continue; // in the index but deleted from the working tree
      if (info.isSymbolicLink()) {
        excluded.symlinks++;
        continue;
      }
      if (!info.isFile()) continue;
      files.push({ path, size: info.size });
    }
    if (unsafe) warnings.push(`Se ignoraron ${unsafe} rutas con un formato no seguro.`);
    if (truncated) warnings.push(`El listado se detuvo en ${maxFiles.toLocaleString('es')} archivos.`);

    const languages = new Map<string, number>(),
      directories = new Map<string, number>(),
      topLevel = new Set<string>();
    for (const file of files) {
      const parts = file.path.split('/');
      topLevel.add(parts.length > 1 ? `${parts[0]}/` : parts[0]!);
      for (let depth = 1; depth < parts.length && depth <= 3; depth++) {
        const dir = parts.slice(0, depth).join('/');
        directories.set(dir, (directories.get(dir) ?? 0) + 1);
      }
      const language = LANGUAGES[extensionOf(parts.at(-1)!)] ?? 'Otro';
      languages.set(language, (languages.get(language) ?? 0) + 1);
    }
    const lower = (path: string) => path.toLowerCase();
    const hasCode = files.some(
      file =>
        !lower(file.path).startsWith('docs/') &&
        !['readme', 'readme.md', '.gitignore', '.gitattributes', 'license', 'license.md', 'license.txt'].includes(
          lower(file.path),
        ),
    );
    const depthOf = (path: string) => path.split('/').length;
    const scan: RepositoryScanDto = {
      repositoryName: basename(root) || 'Repositorio',
      totalFiles: files.length,
      truncated,
      hasCode,
      languages: [...languages]
        .map(([language, count]) => ({ language, files: count }))
        .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language))
        .slice(0, 20),
      topLevel: [...topLevel].sort().slice(0, MAX_TOP_LEVEL),
      directories: [...directories]
        .map(([path, count]) => ({ path, files: count }))
        .sort((a, b) => depthOf(a.path) - depthOf(b.path) || b.files - a.files || a.path.localeCompare(b.path))
        .slice(0, MAX_DIRECTORIES)
        .sort((a, b) => a.path.localeCompare(b.path)),
      files: [],
      excluded,
      warnings,
      scannedAt: new Date().toISOString(),
    };

    // Which contents say most about the stack and the design system, in priority order.
    const candidates: Array<{ path: string; size: number; kind: RepositoryScanFileKind }> = [];
    const manifests = files
      .filter(
        file =>
          depthOf(file.path) <= 3 &&
          (MANIFEST_NAMES.has(lower(basename(file.path))) || BUILD_CONFIG.test(lower(basename(file.path)))),
      )
      .sort((a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path))
      .slice(0, MAX_MANIFESTS);
    const readme = files.find(file => /^readme(?:\.md|\.txt)?$/.test(lower(file.path)));
    const styles = files
      .flatMap(file => {
        const rank = styleRank(file.path);
        return rank === null || depthOf(file.path) > 5 ? [] : [{ ...file, rank }];
      })
      .sort((a, b) => a.rank - b.rank || depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path))
      .slice(0, MAX_STYLES);
    const ci = files
      .filter(
        file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(lower(file.path)) || lower(file.path) === '.gitlab-ci.yml',
      )
      .slice(0, MAX_CI);
    const rootManifests = manifests.filter(file => depthOf(file.path) === 1),
      nested = manifests.filter(file => depthOf(file.path) > 1);
    candidates.push(...rootManifests.map(file => ({ ...file, kind: 'MANIFEST' as const })));
    if (readme) candidates.push({ ...readme, kind: 'README' });
    candidates.push(...styles.slice(0, 3).map(({ rank: _rank, ...file }) => ({ ...file, kind: 'STYLE' as const })));
    candidates.push(...nested.map(file => ({ ...file, kind: 'MANIFEST' as const })));
    candidates.push(...styles.slice(3).map(({ rank: _rank, ...file }) => ({ ...file, kind: 'STYLE' as const })));
    candidates.push(...ci.map(file => ({ ...file, kind: 'CI' as const })));

    const size = () => byteLength(JSON.stringify(scan));
    let skipped = 0;
    for (const candidate of candidates) {
      const remaining = maxBytes - size() - 256; // room for the warning added at the end
      if (remaining < 400) {
        skipped++;
        continue;
      }
      const read = await this.readContent(root, candidate.path, candidate.kind).catch(() => null);
      if (!read) continue;
      const entry: RepositoryScanFileDto = {
        path: candidate.path,
        kind: candidate.kind,
        bytes: candidate.size,
        truncated: read.truncated,
        content: redactSecrets(read.text),
      };
      // Fit the entry as it will be serialized (escaping makes JSON larger than the text).
      let budget = Math.min(
        FILE_LIMIT[candidate.kind],
        remaining - byteLength(JSON.stringify({ ...entry, content: '' })) - 2,
      );
      while (budget > 0 && byteLength(JSON.stringify(entry)) + 1 > remaining) {
        entry.content = cutBytes(entry.content, budget);
        entry.truncated = true;
        budget = Math.floor(budget * 0.85);
      }
      if (byteLength(JSON.stringify(entry)) + 1 > remaining) {
        skipped++;
        continue;
      }
      scan.files.push(entry);
    }
    if (skipped)
      scan.warnings.push(
        `${skipped} archivo${skipped === 1 ? '' : 's'} no cupieron en el límite de ${Math.round(maxBytes / 1024)} KB.`,
      );
    // Last guard: the serialized scan never exceeds the limit, whatever happened above.
    while (size() > maxBytes && scan.files.length) scan.files.pop();
    while (size() > maxBytes && scan.directories.length) scan.directories.pop();
    return scan;
  }

  /** Reads the beginning of a file without following links and only if it really is inside the repository; null for binary or unreadable files. */
  private async readContent(
    root: string,
    path: string,
    kind: RepositoryScanFileKind,
  ): Promise<{ text: string; truncated: boolean } | null> {
    const full = join(root, ...path.split('/'));
    if ((await realpath(dirname(full))) !== dirname(full)) return null;
    const limit = FILE_LIMIT[kind];
    const handle = await open(full, constants.O_RDONLY | NO_FOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) return null;
      const wanted = Math.min(info.size, kind === 'STYLE' ? STYLE_SCAN_BYTES : limit + 1);
      const buffer = Buffer.alloc(wanted);
      const { bytesRead } = await handle.read(buffer, 0, wanted, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.includes(0)) return null;
      let text = bytes.toString('utf8'),
        truncated = info.size > bytesRead;
      if (byteLength(text) > limit) {
        // A large style file keeps the lines that define its design system; any other file keeps its beginning.
        if (kind === 'STYLE')
          text = text
            .split('\n')
            .filter(line => TOKEN_LINE.test(line))
            .map(line => line.trim())
            .join('\n');
        if (byteLength(text) > limit) text = cutBytes(text, limit);
        truncated = true;
      }
      return { text, truncated };
    } finally {
      await handle.close();
    }
  }
}
