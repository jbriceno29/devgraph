# Benchmark Etapa 5: todo-v2

Fecha: 2026-11-11 · Modelo: haiku · Base: `2d321f6`

13 tareas en 3 features. La primera tarea fija una convención (opciones como objeto final, validaciones con RangeError) y un vocabulario (prioridades baja/media/alta, fechas AAAA-MM-DD) que las tareas posteriores no repiten; las pruebas ocultas lo comprueban.

| | Chat: una conversación | Chat: una por feature | Graph Workspace (piloto) |
| :--- | ---: | ---: | ---: |
| Tareas que pasan todas sus pruebas ocultas | 12 de 13 | 11 de 13 | 10 de 13 |
| Pruebas ocultas (pasan / total) | 31 / 33 | 30 / 33 | 29 / 33 |
| Pruebas de la convención (RangeError) | 9 / 9 | 8 / 9 | 7 / 9 |
| Tokens de entrada sin caché | 104.984 | 119.567 | 360.757 |
| Tokens leídos de caché | 3.091.648 | 1.483.342 | 1.679.517 |
| Tokens de salida | 75.087 | 69.851 | 76.702 |
| Tiempo del motor | 5.7 min | 5.1 min | 5.8 min |
| Ejecuciones | 13 | 13 | 13 |
| Acciones denegadas | 1 | 4 | 2 |
| Intervenciones humanas | 13 mensajes | 13 mensajes | 0 (esperas del piloto) |

| Tarea | Chat: una conversación: ocultas | Chat: una por feature: ocultas | Graph Workspace (piloto): ocultas |
| :--- | ---: | ---: | ---: |
| TASK-201 Prioridad de tareas | 3/3 | 3/3 | 3/3 |
| TASK-202 Fecha límite | 4/4 | 4/4 | 4/4 |
| TASK-203 Etiquetas | 4/4 | 4/4 | 3/4 |
| TASK-204 Eliminar tareas | 2/2 | 2/2 | 2/2 |
| TASK-205 Renombrar tareas | 3/3 | 3/3 | 3/3 |
| TASK-206 Filtros combinables | 2/2 | 2/2 | 2/2 |
| TASK-207 Ordenar tareas | 3/3 | 3/3 | 3/3 |
| TASK-208 Tareas vencidas | 2/2 | 2/2 | 2/2 |
| TASK-209 Resumen por prioridad | 0/2 | 0/2 | 0/2 |
| TASK-210 Guardar y cargar | 2/2 | 2/2 | 2/2 |
| TASK-211 Exportar a CSV | 2/2 | 2/2 | 2/2 |
| TASK-212 Importar desde CSV | 1/1 | 1/1 | 1/1 |
| TASK-213 Validar datos externos | 3/3 | 2/3 | 2/3 |

Piloto: FEAT-201 COMPLETED (Todas las tareas de la feature están cerradas.) · FEAT-202 COMPLETED (Todas las tareas de la feature están cerradas.) · FEAT-203 COMPLETED (Todas las tareas de la feature están cerradas.)

Notas: "sin caché" incluye la creación de caché; la lectura de caché es mucho más barata. Los brazos chat no tienen reintentos; el piloto tiene hasta 2 intentos por tarea y solo acepta con `node --test` en verde.

## Análisis

**Corrección del juez.** TASK-209 (resumen por prioridad) falló en los tres brazos por un enunciado ambiguo: decía `summarize(lista)` sin aclarar que recibe el objeto de `createTaskList()`, y los tres agentes lo interpretaron como un arreglo. No distingue entre brazos y se excluye de la lectura; el enunciado ya está corregido en `scenario.json`. Sin esa tarea: chat largo 12/12, chat por feature 11/12, workspace 10/12.

**Calidad: el workspace quedó último.** Sus dos fallos propios son justo de la convención (`RangeError`) fijada en la primera tarea y no repetida después: TASK-203 lanzó `Error` y TASK-213 dejó pasar un `SyntaxError`. El chat largo la respetó en 9 de 9 pruebas, y el chat por feature en 8 de 9.

**Por qué falló la memoria del workspace:**
1. **El resumen de cierre perdió la regla.** En "Decisiones", el agente de TASK-201 anotó que `validatePriority()` lanza `RangeError`, pero no la convención general. El texto original de la tarea sí llegó al contexto de TASK-203, pero como una fuente de nivel 5 entre 24.
2. **Ruido en el contexto.** El contexto de TASK-203 incluyó las especificaciones de tareas pendientes de otras features (TASK-206 a TASK-213), traídas por la búsqueda de texto. Son distractores.
3. **Las convenciones no viven donde deben.** El producto tiene un nivel 1 para reglas del proyecto, que siempre se incluye, pero ninguna decisión se promueve ahí.

**Tokens: el workspace es el más caro.** 360.757 tokens sin caché frente a 104.984 (chat largo) y 119.567 (chat por feature), unas 3,4 veces más. Es el costo estructural de abrir una sesión nueva por tarea (unos 20.000 tokens sin caché por arranque). Con un peso aproximado de 0,1 para la lectura de caché, el costo equivalente queda en unos 530.000 para el workspace, 415.000 para el chat largo y 270.000 para el chat por feature.

**Lo que no apareció:** el chat largo no se degradó en 13 tareas con `haiku` (no hubo compactación). El dolor que el proyecto quiere resolver no se manifiesta a este tamaño.

**Autonomía (H4): se mantiene.** El piloto cerró las 3 features sin intervención, con tiempo de motor igual al chat.

## Veredicto según el criterio de corte

H1 no pasa por segunda vez, y en esta prueba el workspace es peor en calidad y en costo. H4 pasa. Según el plan, corresponde replantear antes de seguir construyendo.
