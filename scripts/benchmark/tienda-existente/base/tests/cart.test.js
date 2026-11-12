import test from 'node:test';
import assert from 'node:assert/strict';
import { addLine, applyCoupon, cartTotal, createCart, removeLine } from '../src/index.js';
import { catalog } from './helpers.js';

const withShirt = () => addLine(createCart(), catalog().find('CAM-01').value, 2).value;

test('adds and removes lines without mutating the cart', () => {
  const empty = createCart();
  const cart = addLine(empty, catalog().find('CAM-01').value, 2).value;
  assert.equal(empty.lines.length, 0);
  assert.equal(cartTotal(cart), 3998);
  assert.equal(removeLine(cart, 'CAM-01').value.lines.length, 0);
  assert.equal(addLine(cart, catalog().find('TAZ-01').value, 0).ok, false);
});
test('a fixed coupon takes cents off, never below zero', () => {
  assert.equal(cartTotal(applyCoupon(withShirt(), { type: 'FIXED', value: 500 }).value), 3498);
  assert.equal(cartTotal(applyCoupon(withShirt(), { type: 'FIXED', value: 999999 }).value), 0);
  assert.equal(applyCoupon(withShirt(), { type: 'RARO', value: 1 }).ok, false);
});
