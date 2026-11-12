import { fail, ok } from '../shared/result.js';

const ZONES = { PENINSULA: 495, BALEARES: 795, CANARIAS: 1295 };
const FREE_FROM = 5000;

/** Shipping cost in cents for a zone and a cart subtotal (free from 50 €). */
export function shippingCost(zone, subtotalCents) {
  if (!(zone in ZONES)) return fail(`Zona de envío desconocida: ${zone}`);
  return ok(subtotalCents >= FREE_FROM ? 0 : ZONES[zone]);
}
