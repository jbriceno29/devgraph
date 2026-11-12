import { createNote } from '../src/lib/notes';
/** A note for the tests, built through createNote and adjusted (fields are plain data). */
export function note(title: string, extra: Record<string, unknown> = {}) {
  const result = createNote({ title });
  if (!result.ok) throw new Error(`createNote falló: ${result.error}`);
  return { ...result.value, ...extra };
}
export function rejected(fn: () => unknown) {
  let value: unknown;
  value = fn();
  const result = value as { ok?: unknown; error?: unknown };
  return result?.ok === false && typeof result.error === 'string' && result.error.length > 0;
}
