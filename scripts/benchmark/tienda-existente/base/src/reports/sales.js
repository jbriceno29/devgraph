/** Orders that count as sales: paid, shipped or delivered (never pending or cancelled). */
export const countedOrders = orders => orders.filter(order => ['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status));

/** Cents sold per SKU, over the orders that count as sales. */
export function salesByProduct(orders) {
  const totals = {};
  for (const order of countedOrders(orders))
    for (const line of order.lines) totals[line.sku] = (totals[line.sku] ?? 0) + line.unitCents * line.quantity;
  return totals;
}
