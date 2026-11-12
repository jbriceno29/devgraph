import { fail, ok } from '../shared/result.js';

/** A cart: lines by SKU and an optional coupon. Carts are never mutated: every change returns a new one. */
export const createCart = () => ({ lines: [], coupon: null });

export function addLine(cart, product, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity <= 0) return fail('La cantidad debe ser un entero positivo.');
  const existing = cart.lines.find(line => line.sku === product.sku);
  const lines = existing
    ? cart.lines.map(line => (line.sku === product.sku ? { ...line, quantity: line.quantity + quantity } : line))
    : [...cart.lines, { sku: product.sku, name: product.name, unitCents: product.priceCents, quantity }];
  return ok({ ...cart, lines });
}

export function removeLine(cart, sku) {
  if (!cart.lines.some(line => line.sku === sku)) return fail(`El carrito no tiene ${sku}.`);
  return ok({ ...cart, lines: cart.lines.filter(line => line.sku !== sku) });
}

export const subtotal = cart => cart.lines.reduce((total, line) => total + line.unitCents * line.quantity, 0);

/** Subtotal minus the coupon's discount (see discounts.js), never below zero. */
export function cartTotal(cart) {
  const discount = cart.coupon?.discountCents ?? 0;
  return Math.max(0, subtotal(cart) - discount);
}
