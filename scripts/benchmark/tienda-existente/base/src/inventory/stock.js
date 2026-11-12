import { fail, ok } from '../shared/result.js';

/** Units in stock per SKU. */
export const createStock = (initial = {}) => ({ ...initial });

export function reserve(stock, sku, quantity) {
  const available = stock[sku] ?? 0;
  if (quantity > available) return fail(`No hay stock suficiente de ${sku} (quedan ${available}).`);
  return ok({ ...stock, [sku]: available - quantity });
}

export const restock = (stock, sku, quantity) => ok({ ...stock, [sku]: (stock[sku] ?? 0) + quantity });
