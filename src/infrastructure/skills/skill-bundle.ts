import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Plan S4: skills that ship with the app. Each one lives in `skills/<id>/` (copied next to the core at build time):
 * `skill.json` (origin, pinned commit, license, content hash, what it applies to), the licence texts, and `content/`,
 * which is copied as is into a run's worktree at `.claude/skills/<id>/`. Nothing is downloaded at run time, and a
 * bundle whose content no longer matches its hash is refused.
 */
export interface SkillManifest {
  id: string;
  title: string;
  /** Repository and commit the content was taken from. */
  source: { repository: string; commit: string; path: string };
  license: string;
  /** sha256 of `content/` (see contentHash). */
  sha256: string;
  /** Which tasks receive it. */
  appliesTo: 'INTERFACE';
  /** Commands the device must have for the skill to work; empty when it only needs the engine. */
  requires: string[];
  /** One line for the agent's prompt: how the skill maps onto this workspace. */
  promptNote: string;
}

export interface BundledSkill {
  manifest: SkillManifest;
  contentDirectory: string;
}

/** The skills folder next to the compiled core (dist/main/skills, or resources/core/skills in the packaged app). */
export const DEFAULT_SKILLS_DIRECTORY = fileURLToPath(new URL('../../skills/', import.meta.url));

export async function loadBundledSkills(directory = DEFAULT_SKILLS_DIRECTORY): Promise<BundledSkill[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const skills: BundledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = join(directory, entry.name);
    const manifest = JSON.parse(await readFile(join(root, 'skill.json'), 'utf8')) as SkillManifest;
    if (manifest.id !== entry.name || !/^[a-z0-9-]+$/.test(manifest.id))
      throw new Error(`Skill incluida con id inválido: ${entry.name}`);
    const contentDirectory = join(root, 'content');
    const hash = await contentHash(contentDirectory);
    if (hash !== manifest.sha256)
      throw new Error(
        `La skill ${manifest.id} no coincide con su hash: el paquete de la app está alterado o incompleto.`,
      );
    skills.push({ manifest, contentDirectory });
  }
  return skills.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

/** sha256 over every file of the folder, in path order: `path\0content\0` for each. */
export async function contentHash(directory: string): Promise<string> {
  const files = (await listFiles(directory)).sort();
  const hash = createHash('sha256');
  for (const file of files)
    hash
      .update(`${relative(directory, file).split(sep).join('/')}\0`)
      .update(await readFile(file))
      .update('\0');
  return hash.digest('hex');
}

/** Copies the skill into the worktree's project skills folder; returns the path the run owns (relative, with `/`). */
export async function materializeSkill(skill: BundledSkill, workingDirectory: string): Promise<string> {
  const target = join(workingDirectory, '.claude', 'skills', skill.manifest.id);
  await mkdir(join(workingDirectory, '.claude', 'skills'), { recursive: true });
  await cp(skill.contentDirectory, target, { recursive: true, force: true, errorOnExist: false });
  return `.claude/skills/${skill.manifest.id}`;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry =>
      entry.isDirectory()
        ? listFiles(join(directory, entry.name))
        : Promise.resolve(entry.isFile() ? [join(directory, entry.name)] : []),
    ),
  );
  return nested.flat();
}
