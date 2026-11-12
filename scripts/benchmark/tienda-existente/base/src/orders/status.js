/** The life of an order. Every status change goes through canTransition. */
export const TRANSITIONS = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
export const STATUSES = Object.keys(TRANSITIONS);
export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);
