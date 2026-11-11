/**
 * Prototypes are HTML written by a model or imported by the user, and they run in the app inside a sandboxed iframe. The viewer
 * grants scripts (so the prototype is interactive) but no network: this policy forbids loading or sending anything outside the document.
 * The rest of the isolation is the iframe itself (`sandbox="allow-scripts allow-forms"` only, forms being harmless under this policy: opaque origin, no access to the app, its storage or the top window).
 */
export const PROTOTYPE_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

const NETWORK_APIS: Array<[RegExp, string]> = [[/\bfetch\s*\(/, 'fetch()'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'], [/\bEventSource\b/, 'EventSource'], [/\bsendBeacon\b/, 'sendBeacon']];

/**
 * What in a prototype tries to reach the Internet (hosts of absolute URLs and network APIs), at most 6 entries, so the user knows why
 * a font, image or script will not load. The viewer blocks all of it anyway; this only explains.
 */
export function findExternalReferences(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[/:?#"'\s)>]|$)/gi)) found.add(match[1]!.toLowerCase());
  for (const [pattern, label] of NETWORK_APIS) if (pattern.test(html)) found.add(label);
  return [...found].slice(0, 6);
}
