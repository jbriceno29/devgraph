import { fail, ok } from '../shared/result.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A customer account. */
export function createUser({ name, email } = {}) {
  if (typeof name !== 'string' || !name.trim()) return fail('El nombre es obligatorio.');
  if (typeof email !== 'string' || !EMAIL.test(email)) return fail('El correo no es válido.');
  return ok({ name: name.trim(), email: email.toLowerCase(), addresses: [] });
}

export function addAddress(user, address) {
  if (typeof address?.city !== 'string' || !address.city.trim()) return fail('La dirección necesita una ciudad.');
  return ok({ ...user, addresses: [...user.addresses, { ...address }] });
}
