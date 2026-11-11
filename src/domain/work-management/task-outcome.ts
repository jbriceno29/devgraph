/** What an accepted task left behind: the agent's closing summary and the evidence of the integrated change. */
export interface TaskOutcome {
  workItemId: string;
  projectId: string;
  executionId: string;
  /** The agent's final message: what it did, decisions taken and what is left pending. */
  summary: string;
  files: Array<{ path: string; status: 'ADDED'|'MODIFIED'|'DELETED'|'RENAMED' }>;
  checks: Array<{ command: string; passed: boolean }>;
  mergedCommit: string | null;
  integrationBranch: string | null;
  createdAt: string;
}

const SECTION = /^\s*(?:#{1,6}\s*)?\**\s*(hecho|decisiones|convenciones|pendiente)\s*\**\s*:?\s*\**\s*(.*)$/i;

/**
 * The general rules a task declared in the "Convenciones" section of its closing summary. They reach every later task
 * of the project as tier-1 context: a convention lost in a summary cannot be recovered by the tasks that follow.
 */
export function extractConventions(summary: string): string[] {
  const rules: string[] = [];
  let inside = false;
  for (const line of summary.split(/\r?\n/)) {
    const heading = SECTION.exec(line);
    if (heading) {
      inside = heading[1]!.toLowerCase() === 'convenciones';
      if (inside && heading[2]!.trim()) rules.push(heading[2]!.trim());
      continue;
    }
    if (!inside) continue;
    const item = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (item) rules.push(item);
  }
  // "Ninguna" / "Ninguna nueva. Seguí las existentes…" restate rules already recorded: never store them as new ones.
  return rules.map(rule => rule.replace(/\*\*/g, '').trim()).filter(rule => rule && !/^ningun[ao]s?\b/i.test(rule));
}

/**
 * A grouped run closes several tasks with one summary: one section per WorkItem, each headed by the task key
 * («## TASK-002 …», «**TASK-002**», «Parte 2 de 3: TASK-002 …»). Returns the section of every key, or null when any
 * key has no heading, so the caller can fall back to the shared summary. Text before the first heading goes with
 * the first section found.
 */
export function splitSummaryByTask(summary: string, keys: readonly string[]): Map<string, string> | null {
  const lines = summary.split(/\r?\n/);
  const headings: Array<{ key: string; line: number }> = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    for (const key of keys) {
      if (seen.has(key)) continue;
      const pattern = new RegExp(`^\\s*(?:#{1,6}\\s*|\\*\\*\\s*|[-*]\\s+)?(?:parte\\s+\\d+(?:\\s+de\\s+\\d+)?\\s*[:.\\-–]?\\s*)?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
      if (pattern.test(line)) { headings.push({ key, line: index }); seen.add(key); break; }
    }
  }
  if (headings.length !== keys.length) return null;
  const sections = new Map<string, string>();
  for (const [position, heading] of headings.entries()) {
    const start = position === 0 ? 0 : heading.line;
    const end = headings[position + 1]?.line ?? lines.length;
    sections.set(heading.key, lines.slice(start, end).join('\n').trim());
  }
  return sections;
}
