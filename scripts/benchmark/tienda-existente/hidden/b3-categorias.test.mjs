import test from 'node:test';
import assert from 'node:assert/strict';
import { addLine, cancelOrder, createCart, createCatalog, createOrder, payOrder, salesByCategory } from '../src/index.js';

const catalog = createCatalog([
  { sku: 'CAM-01', name: 'Camiseta', priceCents: 1999, category: 'ropa' },
  { sku: 'TAZ-01', name: 'Taza', priceCents: 899, category: 'hogar' },
  { sku: 'VAS-01', name: 'Vaso', priceCents: 300, category: 'hogar' },
]).value;
const order = (...items) =>
  createOrder(items.reduce((cart, [sku, qty]) => addLine(cart, catalog.find(sku).value, qty).value, createCart())).value;

test('B3: suma los céntimos vendidos por categoría con los pedidos que cuentan como venta', () => {
  const orders = [
    payOrder(order(['CAM-01', 1], ['TAZ-01', 2])).value,
    payOrder(order(['VAS-01', 3])).value,
    order(['CAM-01', 5]),
    cancelOrder(payOrder(order(['TAZ-01', 1])).value).value,
  ];
  const result = salesByCategory(orders, catalog);
  const totals = result && 'ok' in result ? result.value : result;
  assert.deepEqual(totals, { ropa: 1999, hogar: 2698 });
});
