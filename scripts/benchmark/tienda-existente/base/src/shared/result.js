/** Every public function returns one of these instead of throwing on invalid input. */
export const ok = value => ({ ok: true, value });
export const fail = error => ({ ok: false, error });
