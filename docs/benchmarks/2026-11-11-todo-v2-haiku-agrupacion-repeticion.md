# Benchmark Etapa 5: repetición de la agrupación de tareas (séptima medición)

Fecha: 2026-11-11 · Modelo: haiku · Producto: `cd351b5` · Base del repositorio de prueba: `2d321f6` · CLI: Claude Code 2.1.318 · Escenarios: todo-v2 y `todo-v2-agrupado` · Solo el brazo workspace, sin reutilizar la sesión y sin tope de turnos.

Objetivo: comprobar si se sostiene el resultado de la sexta medición, en la que agrupar tareas pequeñas (6 ejecuciones en lugar de 13) bajó el costo ponderado de 591 k a 334 k (−43 %) con 32/33 pruebas ocultas, y si la agrupación cuesta calidad. Desde entonces cambió el código del producto (aislamiento de contexto por commit, flags del CLI, propuestas de plan del agente, ramas por dependencia, asistente de inicio), así que la línea base se vuelve a medir con el código actual en lugar de reutilizar 591 k.

Corridas, una tras otra y sin ningún otro proceso del benchmark en paralelo:

- **Base**: todo-v2, 13 ejecuciones, ×1.
- **G1** y **G2**: `todo-v2-agrupado`, 6 ejecuciones, ×2.

No hubo errores de infraestructura ni repeticiones. Las tres corridas terminaron con todas las tareas aceptadas al primer intento.

## Resultados

Costo ponderado = tokens sin caché (entrada + creación de caché) + 0,1 × tokens leídos de caché. Las llamadas al modelo y a herramientas salen de los transcritos del CLI; sus tokens coinciden exactamente con los que registra el producto.

| | Base actual (13 ejec.) | G1 (6 ejec.) | G2 (6 ejec.) | **Agrupado: media [rango]** |
| :--- | ---: | ---: | ---: | ---: |
| Pruebas ocultas | 31/33 | **33/33** | 32/33 | 32,5/33 [32–33] |
| Tareas originales correctas | 11/13 | 13/13 | 12/13 | 12,5/13 |
| Convención respetada (RangeError) | 7/9 | **9/9** | 8/9 | 8,5/9 [8–9] |
| Ejecuciones (intentos) | 13 (13) | 6 (6) | 6 (6) | 6 |
| Llamadas al modelo | 75 | 50 | 46 | 48 [46–50] |
| Llamadas a herramientas | 101 | 70 | 60 | 65 [60–70] |
| Tokens sin caché | 445.645 | 213.770 | 232.777 | 223.274 |
| Tokens leídos de caché | 2.085.068 | 1.541.692 | 1.532.660 | 1.537.176 |
| Tokens de salida | 98.388 | 73.067 | 87.607 | 80.337 |
| **Costo ponderado** | **654 k** | **368 k (−43,8 %)** | **386 k (−41,0 %)** | **377 k [368–386] (−42,4 %)** |
| Tiempo del motor | 7,3 min | 5,3 min | 6,1 min | 5,7 min (−22 %) |
| Intervenciones humanas | 0 | 0 | 0 | 0 |

### Frente a la sexta medición

| | Sexta medición | Ahora | Cambio |
| :--- | ---: | ---: | ---: |
| Línea base (13 ejec.), ponderado | 591 k | 654 k | +10,7 % |
| Agrupado (6 ejec.), ponderado | 334 k | 377 k (368–386) | +12,9 % (+10 % a +16 %) |
| Ahorro del agrupado frente a su base | −43 % | −42,4 % (−41,0 % a −43,8 %) | se mantiene |
| Agrupado actual frente a la base anterior (591 k) | — | −36 % | — |
| Pruebas ocultas: base / agrupado | 33/33 / 32/33 | 31/33 / 32,5/33 | — |

**Las dos configuraciones encarecieron por igual, en torno a un 11–13 %, con el código actual.** El primer mensaje de cada ejecución (prompt de la tarea más las secciones dinámicas del CLI) va de 8,4 k tokens (TASK-201) a 22,9 k (TASK-213), frente a los 4,9–20,0 k de solo el prompt que se midieron en la sexta medición. Es coherente con un contexto curado más grande, aunque las dos cifras no se midieron exactamente igual. Como el aumento afecta a ambas configuraciones, el ahorro relativo de la agrupación no cambia.

### Por ejecución (ponderado y tiempo)

| Base | Pond. | Tiempo | | Agrupado | G1 | G2 |
| :--- | ---: | ---: | --- | :--- | ---: | ---: |
| TASK-201 | 28,9 k | 35 s | | TASK-231 (201+202) | 39,1 k · 43 s | 33,3 k · 45 s |
| TASK-202 | 37,1 k | 33 s | | TASK-232 (203+204+205) | 45,7 k · 43 s | 41,5 k · 48 s |
| TASK-203 | 40,9 k | 39 s | | TASK-233 (206+207) | 63,6 k · 50 s | 54,5 k · 53 s |
| TASK-204 | 39,0 k | 18 s | | TASK-234 (208+209) | 60,1 k · 39 s | 77,5 k · 55 s |
| TASK-205 | 38,8 k | 17 s | | TASK-235 (210+211) | 58,8 k · 51 s | 57,6 k · 59 s |
| TASK-206 | 50,0 k | 31 s | | TASK-236 (212+213) | 100,7 k · 94 s | 121,7 k · 108 s |
| TASK-207 | 50,6 k | 30 s | | | | |
| TASK-208 | 55,9 k | 28 s | | | | |
| TASK-209 | 44,2 k | 24 s | | | | |
| TASK-210 | 60,9 k | 49 s | | | | |
| TASK-211 | 46,4 k | 20 s | | | | |
| TASK-212 | 83,5 k | 63 s | | | | |
| TASK-213 | 78,0 k | 50 s | | | | |

### Pruebas ocultas por tarea original

| Tarea original | Base | G1 | G2 |
| :--- | ---: | ---: | ---: |
| TASK-201 Prioridad de tareas | 3/3 | 3/3 | 3/3 |
| TASK-202 Fecha límite | 4/4 | 4/4 | 4/4 |
| TASK-203 Etiquetas | **3/4** | 4/4 | 4/4 |
| TASK-204 Eliminar tareas | 2/2 | 2/2 | 2/2 |
| TASK-205 Renombrar tareas | 3/3 | 3/3 | 3/3 |
| TASK-206 Filtros combinables | 2/2 | 2/2 | 2/2 |
| TASK-207 Ordenar tareas | 3/3 | 3/3 | 3/3 |
| TASK-208 Tareas vencidas | 2/2 | 2/2 | 2/2 |
| TASK-209 Resumen por prioridad | 2/2 | 2/2 | 2/2 |
| TASK-210 Guardar y cargar | 2/2 | 2/2 | 2/2 |
| TASK-211 Exportar a CSV | 2/2 | 2/2 | 2/2 |
| TASK-212 Importar desde CSV | 1/1 | 1/1 | 1/1 |
| TASK-213 Validar datos externos | **2/3** | 3/3 | **2/3** |

## Qué falló y por qué (código del agente)

Todas las fallas son **deriva de la convención**: el agente lanzó `Error` donde la convención pide `RangeError`. No hay errores de ordenamiento, de lógica ni de formato.

- **Base, TASK-203, «etiqueta vacía → RangeError»**: `tag()` lanza `new Error('La etiqueta no puede estar vacía')`. El agente copió el patrón del código anterior a la convención (`add` lanza `new Error('El título no puede estar vacío')` desde TASK-001, en el commit base). En la misma tarea sí usó `TypeError` para el tipo incorrecto. El código existente pesó más que la convención curada.
- **Base, TASK-213, «JSON mal formado → RangeError»**: `loadTasks` lanza `new Error('El archivo … no contiene JSON válido')`. Esa línea la escribió **TASK-210**, y TASK-213 añadió validaciones de prioridad y fecha con `RangeError`, pero no corrigió el `Error` heredado.
- **G2, TASK-213 (segunda parte de TASK-236), mismo criterio**: aquí la escribió la propia ejecución agrupada. Envolvió el `JSON.parse` en `try/catch` con `throw new Error('El archivo JSON no es válido: …')` y documentó en el JSDoc «un Error si el JSON está mal formado». En el resto de esa ejecución usó `RangeError`. Es la misma falla que tuvo la ejecución agrupada de la sexta medición.
- **G1**: sin fallas. Aplicó `RangeError` a todas las validaciones nuevas, incluso a las de tipo. Solo queda el `Error` del título vacío del commit base, que ninguna prueba oculta comprueba.

**El criterio «JSON mal formado → RangeError» de TASK-213 es el punto débil del escenario, con o sin agrupación.** Falla en 3 de las 4 corridas con el código de hoy y la sexta medición: la base actual, el agrupado de la sexta y G2. Pasa en G1. La explicación más probable es que `JSON.parse` lanza `SyntaxError`, y envolverlo en un `Error` genérico es el reflejo natural del modelo. Además, el código base ya usa `Error` para validar, así que el agente tiene un ejemplo local que contradice la convención.

## Lectura

- **El ahorro se sostiene y supera de largo el 10 %.** En las dos repeticiones bajó un 41,0 % y un 43,8 % frente a la base medida con el mismo código (media −42,4 %), prácticamente igual que el −43 % de la sexta medición. El mecanismo es estable:
  - menos de la mitad de ejecuciones;
  - un tercio menos de llamadas al modelo (48 frente a 75);
  - la mitad de tokens sin caché (223 k frente a 446 k);
  - un 26 % menos de lecturas de caché.

  La dispersión entre G1 y G2 (368–386 k, ±2,5 %) es pequeña frente al efecto. El tiempo del motor baja un 22 % (5,7 frente a 7,3 min).
- **La calidad no baja de forma consistente.** El agrupado sacó 33/33 y 32/33 (media 32,5); la base actual sacó 31/33. La única falla del agrupado en esta tanda (G2, TASK-213) es la misma que la de la sexta medición, pero **la base de 13 ejecuciones también la tuvo**. No es un efecto de agrupar: es una debilidad del criterio y de la convención, que aparece en ambas configuraciones. Las fallas restantes son distintas entre corridas (TASK-203 solo en la base), lo que apunta a ruido. Hasta ahora, con el código de hoy y la sexta medición, las corridas de 13 ejecuciones del brazo workspace sacaron 33, 31, 33 y 31 de 33 pruebas ocultas, y las agrupadas 32, 33 y 32.
- **Sigue sin ser estadística.** Son 2 repeticiones del agrupado y 1 de la base actual, en un solo escenario y con un solo modelo. Sirven para ver que el ahorro es reproducible y grande, y que la calidad no cae de forma visible. No sirven para afirmar que la calidad sea igual con un margen conocido, ni para generalizar a tareas más grandes o a otros modelos.
- La ejecución más cara del agrupado es siempre la última (TASK-236, 101–122 k y 94–108 s): junta CSV e importación con validación. En G2 su segunda parte es la que falla. Un grupo grande no empeora la calidad de forma medible, pero concentra el riesgo: si falla, se reintenta el grupo entero (aquí no hizo falta ningún reintento).

## Recomendación para el piloto

**Llevar la agrupación al piloto como opción, desactivada por defecto en la primera versión, y activarla por defecto cuando el piloto real la confirme.** El ahorro (~40 % de tokens, ~20 % de tiempo) se repite en tres corridas y supera de largo el umbral del 10 %. Lo que todavía no está demostrado es que no cueste calidad en proyectos reales, y el ahorro no compensa una regresión silenciosa de convenciones. Descartarla no está justificado.

Salvaguardas, por orden de importancia:

1. **No agrupar la tarea que fija una convención.** La primera tarea de un proyecto, o la que dice «a partir de esta tarea…», va sola, para que la convención quede en el código y en su resumen antes de que la lean las demás. En este escenario eso significa ejecutar TASK-201 sola y agrupar TASK-202 con la siguiente. La sexta medición y esta lo agruparon con TASK-202 y, aun así, las pruebas de TASK-201 y TASK-202 pasaron siempre: es una precaución, no una corrección de una falla observada.
2. **Reforzar las convenciones en el prompt agrupado**: una línea explícita de que los criterios de **todas** las partes siguen las convenciones del proyecto, que se repita al principio de la segunda y la tercera parte y que mencione los errores envueltos (`JSON.parse`, `SyntaxError` → la clase de error de la convención). Así se ataca la falla recurrente de TASK-213, que también afecta a la base de 13 ejecuciones.
3. **Limitar el tamaño**: 2–3 tareas de la misma feature, todas listas, de estimación baja. Cerrar el grupo si la suma de criterios supera ~6, para no repetir el caso de TASK-236.
4. **Trazabilidad por tarea**, como proponía la sexta medición:
   - un apartado por WorkItem en el resumen de cierre;
   - un trailer por tarea en el commit;
   - reintento del grupo entero si falla cualquier criterio;
   - revisión humana por grupo.
5. **Medir en el piloto real** antes de activarla por defecto: pruebas propias en verde y convención respetada por tarea, agrupado frente a no agrupado, en al menos 3–5 features. Si la tasa de deriva de convención del agrupado supera a la del modo normal, se deja desactivada.

Aparte de la agrupación, la deriva del criterio de TASK-213 en la base actual indica que **el código existente que contradice la convención** (el `Error` del título vacío de TASK-001) arrastra al agente. Mencionar en las convenciones el código heredado que no las cumple, o permitir que una tarea lo normalice, ayudaría en las dos configuraciones.

## Reproducir

```bash
npm run build:core
# Copia aislada del proyecto (solo lectura sobre la carpeta de la app):
#   backup SQLite de <app>/projects/<id>/workspace.sqlite → <scratch>/src-ws/projects/<id>/workspace.sqlite
for s in todo-v2 todo-v2-agrupado todo-v2-agrupado; do
  node scripts/benchmark/run-benchmark.mjs --scenario $s --base ~/Documents/repos/todo-app --ref 2d321f6 \
    --workspace <scratch>/src-ws --project <id> --model haiku --arms workspace --out <scratch>/run-$s-$RANDOM
done
# Llamadas al modelo: transcritos ~/.claude/projects/*/<external_session_id>.jsonl, contando los message.id de tipo assistant.
```
