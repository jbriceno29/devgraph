# Benchmark Etapa 5: memoria de tareas condensada en el contexto (novena medición)

Fecha: 2026-11-12 · Modelo: haiku · Base del repositorio de prueba: `2d321f6` · Escenario: `todo-v2` (13 tareas, 3 features, 33 pruebas ocultas) · Brazos `workspace` y `workspace-grouped` (tamaño 3), una corrida cada uno.

Objetivo: recortar el prompt de contexto de la tarea, que la sexta medición señaló como el 40 % del costo y que crece con cada tarea cerrada.

## Qué se midió antes de cambiar nada

En los 13 contextos de una corrida real anterior, el 90 % del texto de las últimas tareas era memoria de tareas ya cerradas (nivel 5): el resumen de cierre completo de cada dependencia, de 2,2 a 3,3 mil caracteres cada uno. Dentro de esos resúmenes, «Convenciones» (9 %) ya viaja aparte como regla de nivel 1, y «Decisiones» y «Pendiente» (38 %) sirven sobre todo a quien viene justo después.

## Cambio

`condenseOutcomeSummary` (`src/domain/work-management/task-outcome.ts`), usado al armar la memoria de cada dependencia:

- Se quita siempre «Convenciones» (ya están en las restricciones).
- Una dependencia que **no es prerrequisito directo** (distancia mayor que 1) conserva solo «Hecho». Los archivos y comprobaciones se mantienen.
- Un resumen sin las secciones se deja intacto.

Simulado sobre las 13 tareas reales: −28 % de caracteres de contexto. Aplicado en la corrida: la memoria de TASK-213 pasó de 21,0 k a 14,8 k caracteres (−30 %).

## Resultados

| | Base (8.ª medición) | Base con el recorte | G3 media (8.ª) | G3 con el recorte |
| :--- | ---: | ---: | ---: | ---: |
| Pruebas ocultas | 28/33 | **33/33** | 33/33 | **33/33** |
| Convención respetada | 9/9 | 9/9 | 9/9 | 9/9 |
| Ejecuciones | 13 | 13 | 9 | 8 |
| Tokens sin caché | 358.167 | 352.272 | 281.396 | 236.379 |
| Tokens leídos de caché | 1.958.505 | 2.011.500 | 1.659.567 | 1.758.544 |
| **Costo ponderado** | **554 k** | **553 k (−0,1 %)** | **442 k** | **412 k (−7 %)** |

## Lectura

- **La calidad no bajó**: 33/33 y 9/9 en ambos brazos, sin intervención humana.
- **El costo no bajó de forma medible.** El brazo sin agrupar queda igual (−0,1 %). El agrupado baja 7 % frente a la media de la 8.ª medición, pero una ejecución menos explica por sí sola parte de eso, y cada variante es una sola corrida: lo que está por debajo de ~10 % no se distingue del ruido.
- **Por qué pesa poco**: el prompt se crea una vez por ejecución y se relee a 0,1 × en las llamadas siguientes. Quitar ~2 mil tokens de un prompt de ~12 mil ahorra del orden de un 7 % del total, que es justo lo que el ruido tapa.

## Decisión

El recorte **se conserva**: es determinista, no costó calidad y elimina una duplicación real (las convenciones llegaban dos veces). No se presenta como ahorro demostrado. La palanca de costo con efecto medido sigue siendo la agrupación de tareas; el resto del prompt (perfil, política y resumen de cierre pedido) no se tocó.

Comando: `node scripts/benchmark/run-benchmark.mjs --scenario todo-v2 --base ~/Documents/repos/todo-app --ref 2d321f6 --model haiku --arms workspace,workspace-grouped --out <dir>`
