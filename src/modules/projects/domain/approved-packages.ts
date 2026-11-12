import { PACKAGE_NAME } from './stack-catalog.js';

/** The packages the user approved for a project, from their stored JSON (invalid names and bad JSON are ignored). */
export function parseApprovedPackages(json: string | null | undefined): string[] {
  try {
    const value = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === 'string' && PACKAGE_NAME.test(name))
      : [];
  } catch {
    return [];
  }
}
