# Benchmark Etapa 5: reutilizar la sesión dentro de la feature (cuarta medición)

Fecha: 2026-11-11 · Modelo: haiku · Escenario: todo-v2 · Solo el brazo workspace, con las correcciones de la tercera medición y además reanudando (`--resume`) la sesión del motor de la última tarea aceptada de la misma feature (una sesión por feature; 3 en total).

| | Chat largo | Chat por feature | Workspace (3.ª medición) | Workspace + sesión por feature |
| :--- | ---: | ---: | ---: | ---: |
| Tareas correctas (sin TASK-209) | 12/12 | 11/12 | 12/12 | 12/12 (13/13 con TASK-209) |
| Convención respetada | 9/9 | 8/9 | 9/9 | 9/9 |
| Tokens sin caché | 104.984 | 119.567 | 395.273 | 343.541 |
| Tokens leídos de caché | 3.091.648 | 1.483.342 | 2.076.293 | 4.947.907 |
| Tokens de salida | 75.087 | 69.851 | 85.354 | 92.928 |
| **Costo ponderado** (sin caché + 0,1 × caché) | **414 k** | **268 k** | **603 k** | **839 k** |
| Tiempo del motor | 5,7 min | 5,1 min | 6,7 min | 7,5 min |
| Intervenciones humanas | 13 | 13 | 0 | 0 |

## Lectura

- **La calidad se mantiene** (12/12, convención 9/9).
- **Reutilizar la sesión no compensa.** Baja los tokens sin caché un 13 %, pero duplica las lecturas de caché, porque cada tarea arrastra la conversación de toda la feature. El costo ponderado sube un 39 %. La opción queda en el código, pero **desactivada por defecto** (`sessionReuse: 'feature'` para activarla).
- **El sobrecosto no viene del contexto curado** (entre 0,4 y 6,6 k tokens por tarea) **ni de cambiar de directorio**: una prueba aislada mostró que reanudar en otro directorio conserva la caché (245 tokens sin caché). Viene del trabajo de cada ejecución: exploración del repositorio, salidas de pruebas y resúmenes de cierre más largos (un 24 % más de salida que el chat).
- **Estado de H1:** con las correcciones, el workspace iguala la calidad del mejor chat sin intervención humana, a un costo ponderado unas 1,5 veces el del chat largo y unas 2,2 veces el del chat por feature. No hay "mejora clara en al menos una métrica sin empeorar las demás" en calidad ni en costo; la mejora medible está en la intervención humana (13 a 0).
