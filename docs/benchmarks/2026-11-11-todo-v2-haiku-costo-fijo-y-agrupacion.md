# Benchmark Etapa 5: costo fijo por ejecución y agrupación de tareas (sexta medición)

Fecha: 2026-11-11 · Modelo: haiku · Base: `2d321f6` · CLI: Claude Code 2.1.318 · Escenarios: todo-v2 y `todo-v2-agrupado` · Solo el brazo workspace, una corrida, sin reutilizar la sesión y sin tope de turnos.

Objetivo: comprobar la hipótesis de la quinta medición, según la cual los ~30 k tokens sin caché de cada ejecución son un costo fijo de arranque, y probar dos palancas: bajar ese costo fijo y agrupar tareas pequeñas en menos ejecuciones.

## 1. El piso del CLI es pequeño; lo que pesa es el prompt de la tarea

**Piso medido** con los mismos flags que `buildClaudeArgs` (`-p --output-format stream-json --verbose --permission-mode dontAsk --permission-prompts none --strict-mcp-config --setting-sources project,local --disable-slash-commands --model haiku --tools Read,Write,Edit,Glob,Grep,Bash` y las reglas de permisos del benchmark), con el prompt «Responde solo: OK»:

| | Tokens |
| :--- | ---: |
| Entrada sin caché | 2 |
| Creación de caché | 1.008 |
| Lectura de caché | 6.818 |
| Salida | 4 |

- **6.818 tokens** son el prompt del sistema del CLI más las definiciones de herramientas. Es idéntico en todas las ejecuciones y ya llega leído de caché: su TTL es de 1 h (`ephemeral_1h`), así que solo se crea una vez por hora y no por ejecución.
- **~1.000 tokens** se crean en caché en cada ejecución: las secciones dinámicas del prompt del sistema (cwd, entorno, estado de git), que cambian en cada worktree, más el propio prompt. Repetida en el mismo directorio, la llamada creó 0 tokens y leyó 7.826 de caché.
- En ponderado (sin caché + 0,1 × caché), el piso cuesta **~1,7 k por ejecución**: unos 22 k en las 13 ejecuciones de v2, el **4 %** de los 591 k.

**La hipótesis queda refutada en parte.** Los 30 k sin caché por ejecución no son el arranque del CLI. Los transcritos de la corrida B (13 ejecuciones, 78 llamadas al modelo; suman exactamente los 391.990 sin caché y los 1.989.921 de caché del informe anterior) se reparten así:

| Componente (corrida B) | Ponderado | % |
| :--- | ---: | ---: |
| Prefijo estático del CLI (6.818 leídos en cada llamada) | 53 k | 9 % |
| Prompt de la tarea: perfil, política, contexto curado y resumen pedido (creado una vez y releído en cada llamada) | 238 k | 40 % |
| Trabajo: lecturas, ediciones, salida de pruebas y respuestas, releídos en las llamadas siguientes | 299 k | 51 % |
| **Total** | **591 k** | |

El prompt de la tarea **crece con cada tarea cerrada**: va de 4,9 k tokens (TASK-201) a 20,0 k (TASK-213), con una media de 12,2 k. El de TASK-213 tiene 38,6 k caracteres:

- 60 % son fuentes de nivel 5: los resúmenes de cierre de otras tareas, de 2,3–3,3 k caracteres cada uno.
- Las convenciones aparecen dos veces: 2,5 k en `<Constraints>` y 5,4 k como fuentes `convention:*`.
- 18 % (7,1 k caracteres) son atributos de las etiquetas `<Source>`: hashes SHA-256 e ids UUID, que se tokenizan mal (~2 caracteres por token en todo el prompt).

El informe de la 4.ª medición estimaba el contexto curado en 0,4–6,6 k tokens; la medida real por la API llega a 20 k.

## 2. Palancas del CLI probadas (2 llamadas)

| Palanca | Resultado en la llamada trivial | Efecto |
| :--- | :--- | :--- |
| `--exclude-dynamic-system-prompt-sections` (existe, en la ayuda) | creación de caché 2.441 · lectura de caché 5.148 | **Peor**: mueve ~1,4 k tokens del prefijo cacheable al primer mensaje, que siempre es nuevo. Solo sirve para compartir caché entre usuarios. |
| Reducir herramientas (`--tools Read,Edit,Bash`, añadido después del `--tools` del adaptador) | 0 / 7.826, igual que la base | Inconcluso: el segundo `--tools` no cambió nada (prevalece el primero o se acumula). En cualquier caso, las herramientas viven en el prefijo de 6,8 k, que es el 9 % del total; quitar Glob/Grep ahorraría una fracción de eso, muy por debajo del 10 %, y empeoraría la exploración. |
| `--bare` | no probado | Descartado: exige `ANTHROPIC_API_KEY` y rompe la autenticación por suscripción. |
| `--setting-sources project,local` y `--disable-slash-commands` | ya aplicados | — |

**Ninguna palanca del adaptador llega al 10 %.** El adaptador no se modifica.

## 3. Agrupación: 6 ejecuciones en lugar de 13

Escenario `scripts/benchmark/todo-v2-agrupado/scenario.json`, generado a partir de todo-v2. Cada tarea agrupada lleva el texto de sus tareas originales como «Parte 1/2/3» y los criterios de todas, prefijados con el título original. Se respetan las features y las dependencias:

| Ejecución | Tareas originales | Depende de |
| :--- | :--- | :--- |
| TASK-231 | TASK-201 + 202 | — |
| TASK-232 | TASK-203 + 204 + 205 | 231 |
| TASK-233 | TASK-206 + 207 | 231, 232 |
| TASK-234 | TASK-208 + 209 | 231, 233 |
| TASK-235 | TASK-210 + 211 | 231, 232 |
| TASK-236 | TASK-212 + 213 | 235 |

El juez es el mismo de todo-v2: las 33 pruebas ocultas, calificadas por tarea original. El arnés acepta ahora `"hidden": "<escenario>"` y `"covers"` sin romper los escenarios existentes.

Workspace aislado: una copia de solo lectura (backup de SQLite) del proyecto en el scratchpad, que se pasa a `--workspace`. La carpeta de datos de la app no se tocó. La copia se hizo después de la corrida B, y desde entonces el usuario había cerrado algunas tareas propias en ese proyecto: hay unas pocas fuentes más (≤ 1 k caracteres por prompt). La diferencia es menor que el efecto medido.

| | Línea base (3.ª) | B: solo tope (5.ª) | **Agrupado** | Chat largo | Chat por feature |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Pruebas ocultas | 33/33 | 33/33 | **32/33** | — | — |
| Tareas correctas (sin TASK-209) | 12/12 | 12/12 | **11/12** (12/13 con ella) | 12/12 | 11/12 |
| Convención respetada | 9/9 | 9/9 | **8/9** | 9/9 | 8/9 |
| Ejecuciones | 13 | 13 | **6** (sin reintentos) | — | — |
| Llamadas al modelo | — | 78 | **44** | — | — |
| Tokens sin caché | 395.273 | 391.990 | **204.310** | 104.984 | 119.567 |
| Tokens leídos de caché | 2.076.293 | 1.989.921 | **1.297.553** | 3.091.648 | 1.483.342 |
| Tokens de salida | 85.354 | 91.646 | **72.392** | 75.087 | 69.851 |
| **Costo ponderado** | **603 k** | **591 k** | **334 k (−45 % / −43 %)** | 414 k | 268 k |
| Tiempo del motor | 6,7 min | 6,9 min | **5,1 min** | 5,7 min | 5,1 min |
| Intervenciones humanas | 0 | 0 | 0 | 13 | 13 |

Desglose del agrupado, con el mismo método que la tabla de la sección 1:

- prefijo estático: 30 k (B: 53 k);
- prompt de la tarea: 127 k (B: 238 k);
- trabajo: 177 k (B: 299 k).

El ahorro no se limita al arranque. Con la mitad de llamadas, el prompt de cada tarea se relee menos veces, y el código y las pruebas que comparten dos tareas se leen una sola vez. Los prompts agrupados apenas crecen: 7,8–17,1 k tokens, frente a 4,9–20,0 k.

**Única falla:** TASK-213, «JSON mal formado → RangeError». `loadTasks` lanzó `Error` («El archivo no contiene JSON bien formado…») y no `RangeError`. El resto de las validaciones de esa misma ejecución sí usan `RangeError`. Es la misma clase de deriva de la convención que tuvo la variante A (2 fallas) con 13 ejecuciones. Con una sola corrida no se puede atribuir a la agrupación. Esa tarea era la segunda parte de la ejecución más grande (11 llamadas, 100 s), así que tampoco se puede descartar que una tarea compuesta diluya la atención sobre los criterios de su segunda parte.

**Ruido:** es una sola corrida. Aun así, −43 % está muy por encima del umbral del 10 %, y la mecánica lo explica: la mitad de ejecuciones da la mitad de prompts y de llamadas. La caída de calidad (−1 prueba de 33) está dentro del ruido observado antes (A: −2), pero hay que vigilarla.

## Recomendación

1. **Llevar al producto la agrupación, como opción del piloto y desactivada por defecto al principio.** El piloto agrupa en una ejecución hasta 2–3 tareas consecutivas de la misma feature cuando:
   - todas están listas (sus dependencias externas ya están cerradas o dentro del grupo);
   - su estimación es baja (p. ej. ≤ 2 criterios cada una o tamaño S);
   - ninguna fija una convención nueva. La primera tarea de un proyecto, o la que pide «a partir de esta tarea…», va sola, para que su convención llegue limpia a las demás.

   El ahorro esperado ronda el 40 % de tokens y el 25 % de tiempo. Con eso el workspace queda por debajo del chat largo (334 k frente a 414 k) y mantiene 0 intervenciones.

2. **Riesgos y trazabilidad.** Hoy una ejecución equivale a un commit, un ChangeSet y un resumen por tarea. Con un grupo:
   - Una ejecución cubre N WorkItems. El resumen de cierre debe pedirse por tarea, con un apartado por WorkItem, para que la memoria de cada una siga siendo útil a sus dependientes.
   - El commit debe listar las N tareas (trailer por tarea). El ChangeSet se comparte, o se parte por archivos si se puede.
   - Si falla un criterio de cualquiera de ellas, se reintenta el grupo entero, y la revisión humana pasa a ser por grupo.
   - La falla de convención de esta corrida apunta a reforzar en el prompt agrupado que **todos** los criterios de **todas** las partes siguen las convenciones del proyecto.

3. **Palanca complementaria, sin perder trazabilidad (fuera del adaptador; lo decide quien mantiene el constructor de contexto):** el prompt de la tarea es el 40 % del costo y crece con cada tarea cerrada. Se puede:
   - no repetir las convenciones (hoy van en `<Constraints>` y además como fuentes);
   - acortar los atributos de `<Source>`: hash truncado o sin hash en el texto enviado, ya que el sellado lo guarda la base de datos;
   - limitar los resúmenes de nivel 5 a las dependencias directas o a sus apartados «Decisiones» y «Pendiente».

   Recortar el prompt a la mitad ahorraría del orden del 20 %. Habría que medirlo, porque esas fuentes son también de donde sale la convención.

4. **No llevar:** `--exclude-dynamic-system-prompt-sections` (empeora la caché), `--bare` (rompe la suscripción) ni recortar herramientas (< 10 %, con riesgo para la exploración). **El adaptador queda igual.**

## Reproducir

```bash
# Copia aislada del proyecto (solo lectura sobre la carpeta de la app):
#   backup SQLite de <app>/projects/<id>/workspace.sqlite → <scratch>/src-ws/projects/<id>/workspace.sqlite
node scripts/benchmark/run-benchmark.mjs --scenario todo-v2-agrupado --base ~/Documents/repos/todo-app --ref 2d321f6 \
  --workspace <scratch>/src-ws --project <id> --model haiku --arms workspace --out <scratch>/run
```
