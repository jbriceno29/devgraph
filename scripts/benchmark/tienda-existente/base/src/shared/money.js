/** Amounts are integer cents everywhere; every calculation rounds to the cent with roundCents. */
export const roundCents = amount => Math.round(amount);

/** The given percentage (0-100) of an amount in cents, rounded to the cent. */
export const percentOf = (cents, percent) => roundCents((cents * percent) / 100);

export function formatMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')} €`;
}
