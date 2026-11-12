# Tienda

Lógica de una tienda en línea (catálogo, carrito, pedidos e informes) en JavaScript sin dependencias.

- Ejecutar las pruebas: `npm test` (usa `node --test`).
- Convenciones: los importes van siempre en céntimos (enteros) y toda función pública devuelve un resultado
  `{ ok: true, value }` o `{ ok: false, error }` con el mensaje en español; nunca lanza por una entrada inválida.
- La API pública se exporta desde `src/index.js`.
