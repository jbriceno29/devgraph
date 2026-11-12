import type { ProjectProfile } from '../../knowledge/index.js';
import { APP_RULES, STACK_PROFILES, type StackProfile } from './stack-profiles.js';

export * from './stack-profiles.js';

export function findStackProfile(id: string | null | undefined): StackProfile | null {
  return STACK_PROFILES.find(profile => profile.id === id) ?? null;
}

/** Every package a profile installs: what the app may install without asking (plan S2). */
export function profilePackages(profile: StackProfile): string[] {
  return [...profile.dependencies, ...profile.devDependencies];
}

/** The catalog as compact data for the inception prompt (token cost matters). */
export function catalogForPrompt(): Array<Pick<StackProfile, 'id' | 'title' | 'whenToUse' | 'techStack'>> {
  return STACK_PROFILES.map(({ id, title, whenToUse, techStack }) => ({ id, title, whenToUse, techStack }));
}

const MAX_RULES = 20,
  MAX_STACK_KEYS = 12;
const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * Merges a stack profile into the proposed project profile. The catalog wins where it is the authority: its stack keys
 * override the model's, its verification commands replace the model's, and the rules go app → profile → project
 * (duplicates removed, within the profile limits).
 */
export function applyStackProfile(proposed: ProjectProfile, profile: StackProfile): ProjectProfile {
  const techStack: Record<string, string> = { ...profile.techStack };
  for (const [key, value] of Object.entries(proposed.techStack))
    if (Object.keys(techStack).length < MAX_STACK_KEYS && !Object.keys(techStack).some(existing => same(existing, key)))
      techStack[key] = value;
  const rules: string[] = [];
  for (const rule of [...APP_RULES, ...profile.rules, ...proposed.rules])
    if (rule.trim() && rules.length < MAX_RULES && !rules.some(existing => same(existing, rule)))
      rules.push(rule.trim());
  return {
    ...proposed,
    stackProfileId: profile.id,
    techStack,
    rules,
    verificationCommands: [...profile.verificationCommands],
  };
}

/** Plan S2: what the app installs in a run's worktree and what the agent may add without asking. */
export interface ProjectEnvironment {
  /** null: the project follows no catalog profile (an existing repository): the app installs what its manifest declares. */
  stackProfileId: string | null;
  /** `npm` for a catalog profile; `detect` reads the repository's lockfile (npm or pnpm). */
  packageManager: 'npm' | 'detect';
  dependencies: string[];
  devDependencies: string[];
  /** The profile's packages plus the ones the user approved. */
  allowedPackages: string[];
  /** Paths the app owns in the worktree: never audited as the agent's changes, never writable by the agent. */
  paths: string[];
}

/** Package names npm accepts (lowercase, optional scope); also what the user may approve. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The environment of a project: its profile's packages, the repository's own manifest when it follows no profile, or null when its profile installs nothing. */
export function environmentFor(
  stackProfileId: string | null | undefined,
  approved: readonly string[] = [],
): ProjectEnvironment | null {
  const profile = findStackProfile(stackProfileId);
  const valid = approved.filter(name => PACKAGE_NAME.test(name));
  // An existing repository (no profile): what its package.json already declares is its environment; new packages ask.
  if (!profile)
    return {
      stackProfileId: null,
      packageManager: 'detect',
      dependencies: [],
      devDependencies: [],
      allowedPackages: [...new Set(valid)],
      paths: ['node_modules'],
    };
  if (profile.packageManager !== 'npm') return null;
  return {
    stackProfileId: profile.id,
    packageManager: 'npm',
    dependencies: [...profile.dependencies],
    devDependencies: [...profile.devDependencies],
    allowedPackages: [...new Set([...profilePackages(profile), ...approved.filter(name => PACKAGE_NAME.test(name))])],
    paths: ['node_modules'],
  };
}
