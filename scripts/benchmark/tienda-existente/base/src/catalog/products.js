import { fail, ok } from '../shared/result.js';

const valid = product =>
  typeof product?.sku === 'string' &&
  product.sku.trim() !== '' &&
  typeof product.name === 'string' &&
  Number.isInteger(product.priceCents) &&
  product.priceCents >= 0 &&
  typeof product.category === 'string';

/** An in-memory catalogue: products by SKU. */
export function createCatalog(products = []) {
  const bySku = new Map();
  for (const product of products) {
    if (!valid(product)) return fail(`Producto inválido: ${product?.sku ?? '(sin sku)'}`);
    bySku.set(product.sku, { ...product });
  }
  return ok({
    find: sku => (bySku.has(sku) ? ok({ ...bySku.get(sku) }) : fail(`No existe el producto ${sku}`)),
    list: () => [...bySku.values()].map(product => ({ ...product })),
    byCategory: category => [...bySku.values()].filter(product => product.category === category),
  });
}
