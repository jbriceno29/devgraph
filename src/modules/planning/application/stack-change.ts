import type { ChangeOperation, ProjectProfile } from '../../knowledge/index.js';
import { STACK_PROFILES, applyStackProfile, catalogForPrompt, findStackProfile } from '../../projects/index.js';

/**
 * Plan C7a: a project already under way may change its stack (for example, from a Node API to Next.js) only through a
 * SET_PROJECT_PROFILE the user approves (it is PROJECT_FOUNDATION: never applied on its own).
 */
const STACK_CHANGE = `\n\nStack change: only if the request asks to change the stack or framework, include one SET_PROJECT_PROFILE (an ADR never replaces it) with stackProfileId from the catalog below, techStack as key/value pairs, the current objectives and outOfScope, and rules with only this project's own conventions; the app adds the profile's stack, rules and checks. Otherwise never propose it.`;

export function stackChangeRule(): string {
  return `${STACK_CHANGE} Catalog: ${JSON.stringify(catalogForPrompt())}`;
}

const catalogRules = (exceptId: string) =>
  new Set(STACK_PROFILES.filter(profile => profile.id !== exceptId).flatMap(profile => profile.rules));

/**
 * Completes a proposed profile with its catalog profile before the user sees it, so the proposal shows exactly what
 * will apply: the profile's stack, rules and verification, without the rules of another catalog profile (the ones the
 * old stack brought). Operations without a known catalog profile pass through unchanged.
 */
export function withCatalogProfile(operation: ChangeOperation): ChangeOperation {
  if (operation.type !== 'SET_PROJECT_PROFILE') return operation;
  const profile = findStackProfile(operation.stackProfileId);
  if (!profile) return operation;
  const stale = catalogRules(profile.id);
  const { type, ...proposed } = operation;
  const merged = applyStackProfile(
    { ...(proposed as ProjectProfile), rules: proposed.rules.filter(rule => !stale.has(rule)) },
    profile,
  );
  return { type, ...merged };
}
