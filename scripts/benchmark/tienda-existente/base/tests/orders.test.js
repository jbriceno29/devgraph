import test from 'node:test';
import assert from 'node:assert/strict';
import { addLine, canTransition, createCart, createOrder, payOrder, shipOrder, salesByProduct } from '../src/index.js';
import { catalog } from './helpers.js';

const order = () => createOrder(addLine(createCart(), catalog().find('TAZ-01').value, 3).value).value;

test('an order moves PENDING → PAID → SHIPPED and never skips a step', () => {
  const paid = payOrder(order()).value;
  assert.equal(paid.status, 'PAID');
  assert.equal(shipOrder(paid).value.status, 'SHIPPED');
  assert.equal(shipOrder(order()).ok, false);
  assert.equal(canTransition('SHIPPED', 'PENDING'), false);
});
test('only paid, shipped or delivered orders count as sales', () => {
  assert.deepEqual(salesByProduct([order(), payOrder(order()).value]), { 'TAZ-01': 2697 });
});
test('an empty cart cannot become an order', () => {
  assert.equal(createOrder(createCart()).ok, false);
});
