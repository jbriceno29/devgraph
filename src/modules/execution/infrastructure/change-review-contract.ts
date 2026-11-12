import type { ChangeReviewVerdict } from '../application/ports/change-review-port.js';
export { buildReviewPrompt } from './prompts/change-review-prompt.js';

/** Engine-independent parts of the change review (plan S5): schema, prompt and parsing. */
export const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'findings'],
  properties: { approved: { type: 'boolean' }, findings: { type: 'array', maxItems: 10, items: { type: 'string' } } },
};

export interface ReviewTask {
  key: string;
  title: string;
  summary: string;
  criteria: string[];
}
export interface ReviewInput {
  tasks: ReviewTask[];
  files: Array<{ path: string; changeType: string; patch: string | null }>;
  checks: string;
  rules: string[];
}

/** Bounds what the reviewer reads: the diff is the evidence, so it is cut per file and in total, and the cut is said. */
export const MAX_REVIEW_DIFF = 60_000,
  MAX_FILE_DIFF = 12_000;

export function parseReview(value: unknown, engine: string): ChangeReviewVerdict {
  const data = value as { approved?: unknown; findings?: unknown } | null;
  if (!data || typeof data.approved !== 'boolean') throw new Error(`${engine} no devolvió un veredicto de revisión.`);
  const findings = Array.isArray(data.findings)
    ? data.findings
        .map(item => String(item).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  // A rejection without reasons gives the agent nothing to fix: the verdict is unusable, so the call fails loudly.
  if (!data.approved && !findings.length) throw new Error(`${engine} rechazó el cambio sin explicar por qué.`);
  return { approved: data.approved, findings: data.approved ? [] : findings };
}
