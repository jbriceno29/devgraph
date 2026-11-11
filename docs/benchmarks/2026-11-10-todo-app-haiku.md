# Benchmark Etapa 5: Gestión avanzada de tareas (todo-app)

Fecha: 2026-11-11 · Modelo: haiku · Base: `2d321f6`

Mismas 5 tareas, mismo commit de partida, mismo modelo y permisos. Juez: pruebas ocultas que ningún agente ve.

| | Chat (una conversación) | Graph Workspace (piloto) |
| :--- | ---: | ---: |
| Tareas que pasan todas sus pruebas ocultas | 5 de 5 | 5 de 5 |
| Pruebas ocultas (pasan / fallan) | 13 / 0 | 13 / 0 |
| Tokens de entrada | 359.784 | 494.762 |
| Tokens de salida | 17.018 | 17.902 |
| Tiempo del motor | 1.3 min | 1.4 min |
| Ejecuciones | 5 | 5 |
| Acciones denegadas | 1 | 1 |
| Mensajes que tuvo que escribir la persona | 5 | 0 (piloto: COMPLETED) |

| Tarea | Chat: tokens entrada / salida | Chat: ocultas | Workspace: intentos | Workspace: tokens entrada / salida | Workspace: ocultas |
| :--- | ---: | ---: | ---: | ---: | ---: |
| TASK-101 Eliminar tareas | 58.543 / 3262 | 3/3 | 1 | 98.797 / 3008 | 3/3 |
| TASK-102 Renombrar tareas | 57.263 / 3262 | 3/3 | 1 | 74.074 / 3375 | 3/3 |
| TASK-103 Filtrar por estado | 70.049 / 2566 | 3/3 | 1 | 101.096 / 2993 | 3/3 |
| TASK-104 Estadísticas de tareas | 52.239 / 1948 | 2/2 | 1 | 72.326 / 2537 | 2/2 |
| TASK-105 Guardar y cargar en JSON | 121.690 / 5980 | 2/2 | 1 | 148.469 / 5989 | 2/2 |

Piloto: COMPLETED · Todas las tareas de la feature están cerradas.

Notas: los tokens de entrada incluyen los leídos de caché. El brazo chat no tiene reintentos; el piloto tiene hasta 2 intentos por tarea y solo acepta con `node --test` en verde.

## Análisis

- **Calidad: empate.** Los dos brazos resolvieron las 5 tareas y pasaron las 13 pruebas ocultas. Con tareas tan bien especificadas, el contexto curado no tiene margen para mejorar el resultado.
- **Tokens: el workspace gastó un 38 % más de entrada** (494.762 frente a 359.784; salida casi igual). No es el contexto curado, que ocupó entre 889 y 2.459 tokens por tarea. Es el costo de arrancar una sesión nueva en cada tarea: el prompt del sistema y las herramientas se vuelven a cargar, y el agente vuelve a leer los archivos que en el chat ya estaban en la conversación (y se reutilizaban desde caché).
- **Tiempo: empate** (1,3 frente a 1,4 min de motor).
- **Orquestación: el workspace sí gana.** La persona escribió 5 mensajes en el chat y ninguno con el piloto, que además verificó cada tarea con `node --test` antes de integrarla.

## Lectura contra las hipótesis

- **H1 (contexto justo) no queda demostrada en este escenario**: igual calidad con más tokens. Por el criterio de corte del plan, H1 no pasa con esta prueba.
- **H4 (autonomía) sí**: misma calidad y tiempo, sin intervención humana.
- **Límite de la prueba**: 5 tareas de una sola feature, cortas, sin cambios de tema y con especificaciones que repiten todo lo necesario. Es justo el caso en que una conversación no se degrada. El dolor que el proyecto quiere resolver (historiales largos, temas mezclados, decisiones tempranas que las tareas siguientes deben respetar sin que se repitan, retomar el trabajo otro día) no está representado.

## Siguiente medición propuesta

Un escenario que ejercite ese dolor: 15 a 20 tareas en 2 o 3 features, con decisiones tomadas en las primeras tareas que las posteriores no repiten en su texto (las pruebas ocultas las comprueban), y el brazo chat obligado a continuar una sola conversación larga, o a empezar conversaciones nuevas como haría una persona en días distintos. Medir también los tokens no cacheados por separado, porque son los que pesan en costo.
