import { useState } from 'react';

/**
 * Ejecuta `reset` durante el render cuando `key` cambia (no en el montaje), en lugar de un `useEffect` que reinicia estado.
 * Un efecto así queda pendiente tras un commit que llegó por una promesa y, si el usuario actúa antes de que se ejecute,
 * React lo aplica después de su acción y la pisa (p. ej. elegir una pestaña y volver a la anterior). Aquí el reinicio
 * ocurre en el mismo render que el cambio, así que nunca llega tarde. `reset` solo debe llamar a setters del propio componente.
 */
export function useResetOnChange(key: unknown, reset: () => void): void {
  const [seen, setSeen] = useState(key);
  if (!Object.is(seen, key)) {
    setSeen(key);
    reset();
  }
}
