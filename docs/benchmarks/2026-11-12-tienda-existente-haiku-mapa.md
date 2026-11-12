# Benchmark R3: mapa del código (tienda-existente)

Fecha: 2026-11-12 · Modelo: haiku · Base: `7fa78ba823aeb5dd51fce117a550cf36f3b38812`

Plan REP, R3: una tienda que ya existe (catálogo, carrito, pedidos, informes y módulos auxiliares) con sus convenciones (céntimos, resultados { ok, value | error }) y una capacidad a medias (cupones de porcentaje). Tres tareas nuevas que deben construir sobre el código existente sin decir dónde está; se compara el piloto con y sin el mapa del código.

| | Sin mapa | Con mapa |
| :--- | ---: | ---: |
| Tareas hechas al primer intento | 3 de 3 | 3 de 3 |
| Pruebas ocultas (pasan / fallan) | 6 / 0 | 6 / 0 |
| Reutilizan el código existente | 3 de 3 | 3 de 3 |
| Llamadas a herramientas antes del primer cambio (1.er intento) | 9 + 9 + 12 = 30 | 5 + 4 + 7 = 16 |
| Tokens de entrada sin caché | 36.513 | 45.107 |
| Tokens leídos de caché | 308.577 | 291.340 |
| Tokens de salida | 14.104 | 12.029 |
| Tiempo del motor | 1.0 min | 0.9 min |

| Tarea | Sin mapa: intentos · exploración · reutiliza | Con mapa: intentos · exploración · reutiliza |
| :--- | :--- | :--- |
| B1 Cupones de porcentaje | 1 · 9 · sí · ocultas 3/3 | 1 · 5 · sí · ocultas 3/3 |
| B2 Cancelar pedidos | 1 · 9 · sí · ocultas 2/2 | 1 · 4 · sí · ocultas 2/2 |
| B3 Ventas por categoría | 1 · 12 · sí · ocultas 1/1 | 1 · 7 · sí · ocultas 1/1 |

Mapa: 8 módulos, 17 capacidades, 25 s, {"inputTokens":8,"outputTokens":6466,"cacheReadTokens":38766,"cacheCreationTokens":9848,"costUsd":0.00559106,"model":"claude-haiku-5-5"}.

Notas: "sin caché" incluye la creación de caché. El piloto tiene hasta 2 intentos por tarea y solo acepta con `node --test` en verde. «Exploración» cuenta las llamadas a herramientas del agente antes de su primer `Edit` o `Write`. «Reutiliza» comprueba el código final de `main`: la función nueva vive en el archivo que ya tenía esa responsabilidad, se define una sola vez y usa el código existente (`percentOf`/`roundCents`, `canTransition`/`moveTo`, `countedOrders`/`salesByProduct`); en B1 además la versión a medias desaparece. Escenario en `scripts/benchmark/tienda-existente/` (base con 9 pruebas, 6 pruebas ocultas validadas contra una solución de referencia, 15/15) y script `scripts/benchmark/run-survey-benchmark.mjs`. Una sola corrida por brazo.

## Análisis (plan REP, R3)

- **Exploración: el mapa la reduce a casi la mitad** (30 → 16 llamadas antes del primer cambio, menos en las tres tareas). Con los punteros a los archivos del módulo y `docs/MAPA_DEL_CODIGO.md` en el contexto, el agente va directo al archivo en vez de listar y buscar.
- **Calidad: empate.** Las 6 tareas se aceptaron al primer intento, pasaron las 6 pruebas ocultas y reutilizaron el código existente. Con una base de 20 archivos que sigue sus convenciones, haiku encuentra lo que existe aunque no tenga mapa; no hubo duplicados que el mapa pudiera evitar.
- **Tokens: mezcla.** La entrada sin caché sube un 24 % (el contexto lleva el documento del mapa y los punteros), la lectura de caché baja un 6 % y la salida un 15 %. En costo ponderado (sin caché + 0,1 × caché) queda 74.241 frente a 67.371: un 10 % más con mapa en un repositorio tan pequeño.
- **El mapa en sí** costó 25 s y 0,006 USD con haiku (8 módulos, 17 capacidades).

## Lectura contra el criterio de corte

El plan pide quedarse solo con el documento si el mapa «no reduce la exploración ni los errores por desconocer el código». Reduce la exploración de forma clara, así que **los nodos se quedan en el grafo**. Lo que no queda demostrado aquí es que evite errores: hace falta un repositorio más grande, donde explorar cueste de verdad y duplicar sea fácil. Ahí también debería invertirse el balance de tokens. Queda para R5 («Poner al día el proyecto»), que repetirá el mapa sobre proyectos reales.
