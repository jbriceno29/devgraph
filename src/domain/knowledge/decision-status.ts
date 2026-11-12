/**
 * Lifecycle of a decision record (ADR). Only ACCEPTED decisions reach the agents' context; SUPERSEDED ones are listed
 * as excluded. A draft is accepted or rejected by the user; an accepted one can be superseded or reopened as a draft,
 * and a rejected or superseded one reopened (a misclick is never final).
 */
export type DecisionStatus = 'DRAFT' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';

const TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  DRAFT: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['SUPERSEDED', 'DRAFT'],
  REJECTED: ['DRAFT'],
  SUPERSEDED: ['DRAFT'],
};

export const isDecisionStatus = (value: string): value is DecisionStatus => value in TRANSITIONS;

/** Statuses a decision in `from` can move to (none for an unknown status). */
export function decisionTransitions(from: string): DecisionStatus[] {
  return isDecisionStatus(from) ? [...TRANSITIONS[from]] : [];
}

export function canTransitionDecision(from: string, to: string): boolean {
  return decisionTransitions(from).includes(to as DecisionStatus);
}

/** The rule as the planner prompt states it. */
export const DECISION_STATUS_RULE = `DECISION_RECORD statuses (UPDATE_ENTITY_STATUS): ${Object.entries(TRANSITIONS)
  .filter(([, to]) => to.length)
  .map(([from, to]) => `${from}→${to.join('|')}`)
  .join(', ')}; only ACCEPTED decisions bind the agents.`;

const NAMES: Record<DecisionStatus, string> = {
  DRAFT: 'en borrador',
  ACCEPTED: 'aceptada',
  REJECTED: 'rechazada',
  SUPERSEDED: 'reemplazada',
};
/** Spanish name of a status, for messages («aceptada»…). */
export const statusName = (status: string) => (isDecisionStatus(status) ? NAMES[status] : status);
