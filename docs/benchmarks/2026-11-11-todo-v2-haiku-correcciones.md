# Benchmark Etapa 5: todo-v2 tras las correcciones (tercera medición)

Fecha: 2026-11-11 · Modelo: haiku · Base: `2d321f6` · Mismo escenario que `2026-11-11-todo-v2-haiku.md`.

Se repitió solo el brazo workspace después de tres correcciones derivadas de la segunda medición:

1. El resumen de cierre pide un apartado **Convenciones**: reglas generales, no detalles de una función.
2. Las convenciones de las tareas aceptadas pasan a ser **reglas de nivel 1 de todo el proyecto**: llegan siempre a todas las tareas siguientes (en `<Constraints>`), aunque no dependan de la que las fijó.
3. Las **tareas pendientes salen de la búsqueda de texto**: son trabajo futuro, no conocimiento, y distraían.

## Comparación (excluyendo TASK-209, cuyo enunciado era ambiguo en la medición anterior)

| | Chat: una conversación | Chat: una por feature | Workspace antes | **Workspace con correcciones** |
| :--- | ---: | ---: | ---: | ---: |
| Tareas correctas | 12/12 | 11/12 | 10/12 | **12/12** (y 13/13 con TASK-209 corregida) |
| Convención respetada | 9/9 | 8/9 | 7/9 | **9/9** |
| Tokens sin caché | 104.984 | 119.567 | 360.757 | 395.273 |
| Tokens leídos de caché | 3.091.648 | 1.483.342 | 1.679.517 | 2.076.293 |
| Tokens de salida | 75.087 | 69.851 | 76.702 | 85.354 |
| Tiempo del motor | 5,7 min | 5,1 min | 5,8 min | 6,7 min |
| Intervenciones humanas | 13 mensajes | 13 mensajes | 0 | **0** |

Los tokens de TASK-209 están incluidos en todas las columnas (no se pueden separar de forma fiable en los brazos chat); la diferencia es pequeña frente al total.

## Lectura

- **Calidad: el workspace pasa de último a empatar con el mejor chat.** Las convenciones de la primera tarea quedaron registradas como reglas generales ("Los valores inválidos que se validan lanzan `RangeError` con mensaje en español") y llegaron a todas las tareas posteriores, incluidas las de otras features.
- **Tokens: sigue costando más.** Unas 3,8 veces más entrada sin caché que el chat largo. Es el costo estructural de abrir una sesión nueva por tarea (prompt del sistema, herramientas y relectura de archivos); el contexto curado en sí ocupa poco.
- **Autonomía: igual calidad sin intervención humana.**
- **H1 según el criterio de corte:** sigue sin "mejora clara en al menos una métrica sin empeorar las demás". Empata en calidad y empeora en tokens. Lo que el workspace aporta, medido, es autonomía con la misma calidad, no un contexto más eficiente.

## Próximo experimento sugerido

Reducir el costo de arranque sin renunciar a que el contexto viva en el workspace: reutilizar la sesión del motor entre tareas de la misma feature (como caché, no como fuente de verdad) y empezar una nueva al cambiar de feature o de motor. Si eso acerca los tokens sin caché a los del chat por feature manteniendo 12/12, H1 quedaría demostrada en el sentido de "misma calidad, menos intervención, costo comparable".
