import test from 'node:test';
import assert from 'node:assert/strict';
import { addAddress, createStock, createUser, formatMoney, reserve, shippingCost } from '../src/index.js';

test('users, shipping, stock and money formatting', () => {
  const user = createUser({ name: ' Ana ', email: 'ANA@x.es' }).value;
  assert.equal(user.email, 'ana@x.es');
  assert.equal(addAddress(user, { city: '' }).ok, false);
  assert.equal(shippingCost('CANARIAS', 1000).value, 1295);
  assert.equal(shippingCost('PENINSULA', 6000).value, 0);
  assert.equal(reserve(createStock({ A: 1 }), 'A', 2).ok, false);
  assert.equal(formatMoney(123456), '1234,56 €');
});
