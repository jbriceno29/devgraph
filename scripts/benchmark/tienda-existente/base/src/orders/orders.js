import { fail, ok } from '../shared/result.js';
import { cartTotal } from '../cart/cart.js';
import { canTransition } from './status.js';

let sequence = 0;

/** An order from a cart: a copy of its lines and total, PENDING until paid. Orders are never mutated. */
export function createOrder(cart) {
  if (!cart?.lines?.length) return fail('No se puede crear un pedido con el carrito vacío.');
  sequence += 1;
  return ok({
    id: `PED-${String(sequence).padStart(4, '0')}`,
    lines: cart.lines.map(line => ({ ...line })),
    totalCents: cartTotal(cart),
    status: 'PENDING',
    history: ['PENDING'],
  });
}

function moveTo(order, status) {
  if (!canTransition(order.status, status)) return fail(`Un pedido ${order.status} no puede pasar a ${status}.`);
  return ok({ ...order, status, history: [...order.history, status] });
}

export const payOrder = order => moveTo(order, 'PAID');
export const shipOrder = order => moveTo(order, 'SHIPPED');
export const deliverOrder = order => moveTo(order, 'DELIVERED');
