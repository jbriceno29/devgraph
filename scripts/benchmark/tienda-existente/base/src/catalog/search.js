const normalize = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Products whose name contains every word of the query (accents and case ignored). */
export function searchProducts(catalog, query) {
  const words = normalize(String(query ?? ''))
    .split(/\s+/)
    .filter(Boolean);
  return catalog.list().filter(product => words.every(word => normalize(product.name).includes(word)));
}
