# Benchmark Etapa 5: tope de exploración por ejecución (quinta medición)

Fecha: 2026-11-11 · Modelo: haiku · Base: `2d321f6` · Escenario: todo-v2 · Solo el brazo workspace, una corrida por variante, sin reutilizar la sesión (`sessionReuse` desactivado, como en la 3.ª medición).

Objetivo: bajar el costo por ejecución sin perder calidad, limitando la exploración del agente.

## Qué ofrece el CLI (Claude Code 2.1.318, probado)

- `--max-turns <n>`: existe aunque **no aparece en `claude --help`**. Al alcanzarlo, el `result` llega con `subtype: "error_max_turns"`, `is_error: true`, `terminal_reason: "max_turns"`, sin `result` y con `errors: ["Reached maximum number of turns (n)"]`; el proceso sale con **código 1**. El `usage` sí se informa. Cuenta las rondas de herramientas: la respuesta final no consume turno (con `--max-turns 2`, una corrida de 3 turnos terminó bien).
- `--max-budget-usd <monto>`: aparece en la ayuda (solo con `-p`). **No probado**; con suscripción el costo es nominal (`total_cost_usd` a precio de lista).
- `--tools`, `--allowedTools`, `--disallowedTools`: ya en uso. `--effort` existe; no se probó aquí.
- No se encontró ninguna variable de entorno documentada para limitar turnos; no se probó ninguna.

Implementado: `maxTurns` en la política de ejecución (0 = sin límite), que el adaptador pasa como `--max-turns`. Alcanzarlo es un fallo `CLAUDE_MAX_TURNS` con un motivo en español que el piloto incluye en el contexto del reintento, y su consumo de tokens ahora cuenta en las métricas (antes solo se registraba el de las ejecuciones terminadas).

## Variantes

- **A**: tope de 40 turnos + guía en el prompt («el contexto de arriba ya incluye lo relevante: lee solo los archivos que vayas a modificar o que cite el contexto, y ejecuta las pruebas al final») + resumen de cierre de 15 líneas como máximo.
- **B**: solo el tope de 40 turnos (prompt igual al de la línea base).

## Resultados

| | Workspace, línea base (3.ª medición) | A: tope + guía | B: solo tope |
| :--- | ---: | ---: | ---: |
| Tareas correctas (sin TASK-209) | 12/12 | 10/12 (11/13) | **12/12** (13/13) |
| Convención respetada | 9/9 | 7/9 | **9/9** |
| Tokens sin caché | 395.273 | 383.919 | 391.990 |
| Tokens leídos de caché | 2.076.293 | 1.702.169 | 1.989.921 |
| Tokens de salida | 85.354 | 79.929 | 91.646 |
| **Costo ponderado** (sin caché + 0,1 × caché) | **603 k** | **554 k (−8 %)** | **591 k (−2 %)** |
| Ejecuciones (intentos) | 13 | 13 | 13 |
| Llamadas a herramientas (total / máx. por tarea) | — | 98 / 10 | 106 / 15 |
| Resumen de cierre (caracteres por tarea) | — | 1.031–1.624 | 1.557–3.062 |
| Tiempo del motor | 6,7 min | 6,1 min | 6,9 min |
| Intervenciones humanas | 0 | 0 | 0 |

En A fallaron TASK-207 y TASK-208 por la convención: lanzaron `TypeError` en lugar de `RangeError` para un argumento de tipo incorrecto. Las convenciones que llegaron a esas tareas ya incluían la excepción «los tipos incorrectos siguen lanzando `TypeError`», que TASK-201 dejó escrita en su resumen. Es la misma deriva que ya se vio en la 2.ª medición, así que puede ser ruido y no efecto de la guía. Con una sola corrida no se puede separar.

## Lectura

- **El tope de turnos no se alcanzó nunca.** Las ejecuciones usan entre 5 y 15 herramientas, con una mediana de 2 lecturas por tarea. El agente ya explora poco, así que un tope holgado no cambia nada (B queda dentro del ruido: −2 %) y un tope ajustado solo provocaría fallos y reintentos, que cuestan más. El sobrecosto frente al chat no viene de la exploración. Cada ejecución carga unos 30 k tokens sin caché; con tan poca exploración, lo más probable (no medido por separado) es que la mayor parte sea el arranque: el prompt del sistema, las herramientas y la creación de caché.
- **La guía del prompt acorta el cierre** (resúmenes de 1,0–1,6 k caracteres en lugar de 1,6–3,1 k; un 13 % menos de salida que B) y baja las lecturas de caché. Pero el ahorro ponderado (−8 %) no llega al umbral del 10 %, y esa corrida perdió calidad (10/12, convención 7/9). No se puede descartar que la guía tenga la culpa: pedir menos lectura deja como fuente de la convención solo el texto curado, sin el código existente.
- **Ruido:** cada variante es una sola corrida. Diferencias por debajo del ~10 % no son señal: B frente a la línea base (−2 %) es, en la práctica, la misma corrida repetida.

## Decisión

- **El tope queda desactivado por defecto** (`maxTurns = 0`, sin límite). Se puede activar desde la política de ejecución del proyecto como red de seguridad contra ejecuciones desbocadas, no como forma de ahorrar.
- **La guía de exploración y el límite del resumen quedan fuera del prompt**: ahorran menos del 10 % y la única corrida con la guía bajó de calidad.
- La palanca de costo que queda es el arranque de cada ejecución (prompt del sistema y herramientas), no la exploración.
