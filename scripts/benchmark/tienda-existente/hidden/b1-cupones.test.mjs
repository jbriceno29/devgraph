import test from 'node:test';
import assert from 'node:assert/strict';
import { addLine, applyCoupon, cartTotal, createCart, createCatalog } from '../src/index.js';

const shirt = createCatalog([{ sku: 'CAM-01', name: 'Camiseta', priceCents: 1999, category: 'ropa' }]).value.find('CAM-01').value;
const cart = () => addLine(createCart(), shirt, 1).value;

test('B1: un cupón de porcentaje descuenta ese porcentaje redondeado al céntimo', () => {
  const applied = applyCoupon(cart(), { type: 'PERCENT', value: 10 });
  assert.equal(applied.ok, true);
  assert.equal(cartTotal(applied.value), 1799);
  assert.equal(cartTotal(applyCoupon(cart(), { type: 'PERCENT', value: 100 }).value), 0);
});
test('B1: un porcentaje fuera de 1..100 devuelve un error sin lanzar (convención)', () => {
  for (const value of [0, 101, 12.5, '10']) {
    const result = applyCoupon(cart(), { type: 'PERCENT', value });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  }
});
test('B1: los cupones fijos siguen funcionando', () => {
  assert.equal(cartTotal(applyCoupon(cart(), { type: 'FIXED', value: 500 }).value), 1499);
});
