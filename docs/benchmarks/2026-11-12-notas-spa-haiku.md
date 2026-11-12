# Benchmark Etapa 5: notas-spa

Fecha: 2026-11-12 · Modelo: haiku · Base: `a8153332de565d311140be397ce9d5de2968b3f7`

SPA de notas con React (perfil web-spa-react): 9 tareas en 3 features sobre una base con dependencias instaladas. La primera tarea fija una convención que las demás no repiten: toda función exportada de src/lib devuelve un resultado { ok: true, value } o { ok: false, error } con un mensaje en español, y nunca lanza por una entrada inválida; las pruebas ocultas cuyo nombre dice «convención» lo comprueban.

| | Chat: una conversación | Graph Workspace (piloto, agrupando) |
| :--- | ---: | ---: |
| Tareas que pasan todas sus pruebas ocultas | 9 de 9 | 9 de 9 |
| Pruebas ocultas (pasan / total) | 26 / 26 | 26 / 26 |
| Pruebas de la convención (convención) | 8 / 8 | 8 / 8 |
| Tokens de entrada sin caché | 47.617 | 194.293 |
| Tokens leídos de caché | 712.382 | 1.323.217 |
| Tokens de salida | 34.489 | 49.693 |
| Costo ponderado (sin caché + 0,1 × leídos) | 118.855 | 326.615 |
| Tiempo del motor | 2.8 min | 4.3 min |
| Ejecuciones | 9 | 7 |
| Acciones denegadas | 1 | 2 |
| Intervenciones humanas | 9 mensajes | 0 (esperas del piloto) |

| Tarea | Chat: una conversación: ocultas | Graph Workspace (piloto, agrupando): ocultas |
| :--- | ---: | ---: |
| TASK-301 Crear notas | 3/3 | 3/3 |
| TASK-302 Editar notas | 3/3 | 3/3 |
| TASK-303 Etiquetas | 3/3 | 3/3 |
| TASK-304 Buscar notas | 3/3 | 3/3 |
| TASK-305 Ordenar notas | 3/3 | 3/3 |
| TASK-306 Filtrar por etiqueta | 3/3 | 3/3 |
| TASK-307 Exportar e importar JSON | 3/3 | 3/3 |
| TASK-308 Lista de notas | 3/3 | 3/3 |
| TASK-309 Campo de búsqueda | 2/2 | 2/2 |

Piloto (Graph Workspace (piloto, agrupando)): FEAT-301 COMPLETED (Todas las tareas de la feature están cerradas.) · FEAT-302 COMPLETED (Todas las tareas de la feature están cerradas.) · FEAT-303 COMPLETED (Todas las tareas de la feature están cerradas.)

Notas: "sin caché" incluye la creación de caché; la lectura de caché es mucho más barata. Los brazos chat no tienen reintentos; el piloto tiene hasta 2 intentos por tarea y solo acepta con `node_modules/.bin/tsc --noEmit` y `node_modules/.bin/vitest run` en verde.

## Análisis (plan S3)

Primera medición con dependencias reales: base con React, Vite, Vitest y TypeScript instalados desde el lockfile; en el brazo workspace la app instala el perfil `web-spa-react` en cada worktree. Escenario en `scripts/benchmark/notas-spa/` (base, 9 tareas, 26 pruebas ocultas validadas contra una solución de referencia, 26/26). Una sola corrida por brazo.

- **Calidad: empate perfecto.** Los dos brazos pasan todas las pruebas ocultas, incluida la convención de resultados que solo enunciaba la primera tarea. Como en `todo-v2`, el escenario no fue lo bastante difícil para separar los brazos.
- **Intervención: 0 frente a 9.** El piloto cerró las 3 features, las integró y no esperó al usuario ni una vez.
- **Costo: 2,75× (326 k frente a 119 k ponderados).** Al desglosarlo, **las dos ejecuciones de interfaz que llevaban Impeccable suman ~202 k**: el grupo TASK-307+308 (JSON más lista de notas, agrupados, así que la skill viajó con toda la ejecución) leyó 739 k tokens de caché, sobre todo referencias de la skill, y TASK-309 costó 58 k frente a 12,8 k en el chat. Sin esas dos, el workspace queda en ~1,7× el chat, en línea con las mediciones anteriores (~1,5×).
- **La skill no se reflejó en las pruebas ocultas**, que solo comprueban comportamiento y accesibilidad básica (roles y etiquetas); el chat sin skill también las pasó. Su posible valor (calidad visual) no lo mide este escenario.

**Decisión tomada a partir de esta medición:** las skills incluidas pasan a ser **opcionales por proyecto y apagadas por defecto** (migración 016, «Stack y skills» en Agentes → Configuración). Siguen instalándose con la app. Para medirlas: `--skills on`. Queda pendiente una medición de calidad visual (por ejemplo, un revisor que compare capturas) antes de recomendarlas por defecto.
