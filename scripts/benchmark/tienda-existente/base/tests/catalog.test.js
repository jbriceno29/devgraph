import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, searchProducts } from '../src/index.js';
import { catalog } from './helpers.js';

test('finds products by SKU and category', () => {
  assert.equal(catalog().find('TAZ-01').value.name, 'Taza de cerámica');
  assert.equal(catalog().find('NO').ok, false);
  assert.equal(catalog().byCategory('ropa').length, 1);
});
test('rejects an invalid product without throwing', () => {
  assert.equal(createCatalog([{ sku: '', name: 'x', priceCents: 1, category: 'a' }]).ok, false);
});
test('searches ignoring accents and case', () => {
  assert.deepEqual(
    searchProducts(catalog(), 'CERAMICA').map(p => p.sku),
    ['TAZ-01'],
  );
});
