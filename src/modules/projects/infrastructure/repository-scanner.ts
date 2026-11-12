import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import type { RepositoryScannerPort } from '../application/ports/repository-scan-port.js';
import {
  MAX_SCAN_BYTES,
  type RepositoryScanDto,
  type RepositoryScanFileKind,
} from '../../../shared/contracts/repository-scan.js';
import { pinnedGit } from './git-repository-initializer.js';
import {
  MAX_LISTED_FILES,
  FILE_LIMIT,
  STYLE_SCAN_BYTES,
  NO_FOLLOW,
  GENERATED_DIRS,
  isSensitivePath,
  isSafeRelativePath,
  LANGUAGES,
  extensionOf,
  redactSecrets,
  byteLength,
  cutBytes,
  TOKEN_LINE,
  MAX_DIRECTORIES,
  MAX_TOP_LEVEL,
} from './repository-scan-rules.js';
import { Candidate, contentCandidates, fitEntry, depthOf, lower } from './repository-scan-contents.js';
export { MAX_LISTED_FILES, isSensitivePath, isSafeRelativePath, redactSecrets } from './repository-scan-rules.js';

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
    const root = await resolveRoot(repositoryPath);
    const maxFiles = this.limits.maxFiles ?? MAX_LISTED_FILES,
      maxBytes = this.limits.maxBytes ?? MAX_SCAN_BYTES;
    const listing = await listFiles(root, maxFiles);
    const scan = summarize(root, listing);
    await this.addContents(root, scan, contentCandidates(listing.files), maxBytes);
    // Last guard: the serialized scan never exceeds the limit, whatever happened above.
    const size = () => byteLength(JSON.stringify(scan));
    while (size() > maxBytes && scan.files.length) scan.files.pop();
    while (size() > maxBytes && scan.directories.length) scan.directories.pop();
    return scan;
  }

  /** The chosen contents, each cut to fit what is left of the byte budget as it will be serialized. */
  private async addContents(root: string, scan: RepositoryScanDto, candidates: Candidate[], maxBytes: number) {
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
      const entry = fitEntry(
        {
          path: candidate.path,
          kind: candidate.kind,
          bytes: candidate.size,
          truncated: read.truncated,
          content: redactSecrets(read.text),
        },
        remaining,
      );
      if (!entry) {
        skipped++;
        continue;
      }
      scan.files.push(entry);
    }
    if (skipped)
      scan.warnings.push(
        `${skipped} archivo${skipped === 1 ? '' : 's'} no cupieron en el límite de ${Math.round(maxBytes / 1024)} KB.`,
      );
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
interface Listing {
  files: Array<{ path: string; size: number }>;
  excluded: RepositoryScanDto['excluded'];
  warnings: string[];
  truncated: boolean;
}

async function resolveRoot(repositoryPath: string): Promise<string> {
  const input = String(repositoryPath ?? '');
  if (!input || input.includes('\0') || !isAbsolute(input))
    throw new Error('La ruta del repositorio debe ser absoluta.');
  if (input.split(/[\\/]+/).some(part => part === '..'))
    throw new Error('La ruta del repositorio no puede contener «..».');
  const root = await realpath(normalize(input)).catch(() => {
    throw new Error(`No se encuentra el repositorio: ${input}`);
  });
  if (!(await lstat(root)).isDirectory()) throw new Error('La ruta del repositorio no es una carpeta.');
  return root;
}

/** What git lists (respecting .gitignore), minus generated folders, credential-like paths and anything through a link. */
async function listFiles(root: string, maxFiles: number): Promise<Listing> {
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
  const listing: Listing = {
    files: [],
    excluded: { ignored: ignoredOthers, generated: 0, symlinks: 0, secrets: 0 },
    warnings: [],
    truncated: false,
  };
  const throughLink = linkChecker(root);
  let unsafe = 0;
  for (const path of listed.sort()) {
    if (listing.files.length >= maxFiles) {
      listing.truncated = true;
      break;
    }
    if (!isSafeRelativePath(path)) unsafe++;
    else await classify(root, path, ignoredTracked, throughLink, listing);
  }
  if (unsafe) listing.warnings.push(`Se ignoraron ${unsafe} rutas con un formato no seguro.`);
  if (listing.truncated) listing.warnings.push(`El listado se detuvo en ${maxFiles.toLocaleString('es')} archivos.`);
  return listing;
}

/** Whether a path goes through a symbolic link (or a missing folder); the answer per folder is cached. */
function linkChecker(root: string) {
  const linkedDirs = new Map<string, boolean>();
  return async (parts: string[]) => {
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
}

async function classify(
  root: string,
  path: string,
  ignoredTracked: Set<string>,
  throughLink: (parts: string[]) => Promise<boolean>,
  listing: Listing,
): Promise<void> {
  const parts = path.split('/');
  if (ignoredTracked.has(path)) listing.excluded.ignored++;
  else if (parts.slice(0, -1).some(part => GENERATED_DIRS.has(part))) listing.excluded.generated++;
  else if (isSensitivePath(path)) listing.excluded.secrets++;
  else if (await throughLink(parts)) listing.excluded.symlinks++;
  else {
    const info = await lstat(join(root, ...parts)).catch(() => null);
    if (!info) return; // in the index but deleted from the working tree
    if (info.isSymbolicLink()) listing.excluded.symlinks++;
    else if (info.isFile()) listing.files.push({ path, size: info.size });
  }
}

/** Languages, top-level entries and folders of the listing; contents are added afterwards. */
function summarize(root: string, listing: Listing): RepositoryScanDto {
  const languages = new Map<string, number>(),
    directories = new Map<string, number>(),
    topLevel = new Set<string>();
  for (const file of listing.files) {
    const parts = file.path.split('/');
    topLevel.add(parts.length > 1 ? `${parts[0]}/` : parts[0]!);
    for (let depth = 1; depth < parts.length && depth <= 3; depth++) {
      const dir = parts.slice(0, depth).join('/');
      directories.set(dir, (directories.get(dir) ?? 0) + 1);
    }
    const language = LANGUAGES[extensionOf(parts.at(-1)!)] ?? 'Otro';
    languages.set(language, (languages.get(language) ?? 0) + 1);
  }
  const hasCode = listing.files.some(
    file =>
      !lower(file.path).startsWith('docs/') &&
      !['readme', 'readme.md', '.gitignore', '.gitattributes', 'license', 'license.md', 'license.txt'].includes(
        lower(file.path),
      ),
  );
  return {
    repositoryName: basename(root) || 'Repositorio',
    totalFiles: listing.files.length,
    truncated: listing.truncated,
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
    excluded: listing.excluded,
    warnings: listing.warnings,
    scannedAt: new Date().toISOString(),
  };
}
