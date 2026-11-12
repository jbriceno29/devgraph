import { fail, ok } from '../shared/result.js';
import { subtotal } from './cart.js';

/**
 * Applies a coupon to the cart: the cart keeps the coupon and the discount it gives, in cents.
 * FIXED: `value` cents off (never more than the subtotal).
 */
export function applyCoupon(cart, coupon) {
  if (!coupon || typeof coupon !== 'object') return fail('Cupón inválido.');
  if (coupon.type === 'FIXED') {
    if (!Number.isInteger(coupon.value) || coupon.value <= 0)
      return fail('El descuento debe ser un entero positivo de céntimos.');
    const discountCents = Math.min(coupon.value, subtotal(cart));
    return ok({ ...cart, coupon: { ...coupon, discountCents } });
  }
  // TODO: cupones de porcentaje (PERCENT, value de 1 a 100): usar percentOf de shared/money.js.
  if (coupon.type === 'PERCENT') return fail('Los cupones de porcentaje todavía no están implementados.');
  return fail(`Tipo de cupón desconocido: ${coupon.type}`);
}

export const removeCoupon = cart => ok({ ...cart, coupon: null });
