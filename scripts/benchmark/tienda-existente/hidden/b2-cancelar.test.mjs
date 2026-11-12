import test from 'node:test';
import assert from 'node:assert/strict';
import { addLine, cancelOrder, createCart, createCatalog, createOrder, payOrder, shipOrder } from '../src/index.js';

const mug = createCatalog([{ sku: 'TAZ-01', name: 'Taza', priceCents: 899, category: 'hogar' }]).value.find('TAZ-01').value;
const order = () => createOrder(addLine(createCart(), mug, 1).value).value;

test('B2: un pedido pendiente o pagado se cancela y queda en su historial', () => {
  const pending = order();
  const cancelled = cancelOrder(pending);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.value.status, 'CANCELLED');
  assert.deepEqual(cancelled.value.history, ['PENDING', 'CANCELLED']);
  assert.equal(pending.status, 'PENDING');
  assert.equal(cancelOrder(payOrder(order()).value).value.status, 'CANCELLED');
});
test('B2: un pedido enviado no se puede cancelar: error sin lanzar (convención)', () => {
  const shipped = shipOrder(payOrder(order()).value).value;
  const result = cancelOrder(shipped);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(cancelOrder(cancelOrder(order()).value).ok, false);
});
