# Benchmark Etapa 5: el piloto agrupando solo (octava medición)

Fecha: 2026-11-11 · Modelo: haiku · Producto: `71edf5e` más las reglas afinadas de esta medición (ver «Reglas») · Base del repositorio de prueba: `2d321f6` · CLI: Claude Code 2.1.318 · Escenario: `todo-v2` (13 tareas, 3 features, 33 pruebas ocultas) · Brazos: `workspace` y `workspace-grouped` de `scripts/benchmark/run-benchmark.mjs`.

Objetivo: medir la agrupación de tareas **donde la recibe el usuario**: la opción «Agrupar tareas pequeñas» del piloto (Etapa 0 de `docs/PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md`), sobre el escenario **sin agrupar a mano**. Las mediciones sexta y séptima usaban `todo-v2-agrupado`, con las 13 tareas fusionadas a mano en 6 ejecuciones; aquí el piloto decide solo qué junta, con sus reglas (misma feature, tope de tareas y de criterios, la tarea que fija una convención sola, la primera tarea del proyecto sola).

Corridas, una tras otra, sin otro proceso del benchmark en paralelo. Cada brazo crea un proyecto nuevo en el workspace (sin copiar el de la app) y corre un piloto por feature; entre features se integra la rama en `main`.

- **Base**: `workspace`, 13 ejecuciones, ×1.
- **G3a** y **G3b**: `workspace-grouped`, tamaño 3, reglas originales (tope fijo de 6 criterios; «convención» en el título o el resumen = tarea sola), ×2.
- **G3r**: `workspace-grouped`, tamaño 3, reglas afinadas (tope = 2 × tamaño; solo las tareas que *fijan* una convención van solas), ×1.
- **G4**: `workspace-grouped`, tamaño 4 (tope 8), reglas afinadas, ×1.

Una primera corrida de la tarde se cortó por el límite de 5 horas de la suscripción: el piloto se pausó al 99 % de la ventana (correcto) y el harness tomó la pausa como fin de la feature. Se corrigió el harness (espera las pausas, para limpio si un piloto no termina) y se repitió al renovarse la ventana. Esas corridas cortadas no cuentan.

## Resultados

Costo ponderado = tokens sin caché (entrada + creación de caché) + 0,1 × tokens leídos de caché, sumado sobre las ejecuciones aceptadas, tal como lo registra el producto (`metrics:feature_report`); una ejecución agrupada cuenta una sola vez.

| | Base (13 ejec.) | G3a | G3b | **G3 media** | G3r (reglas afinadas) | G4 (tamaño 4) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tareas con todas sus pruebas ocultas | 10/13 | **13/13** | **13/13** | 13/13 | **13/13** | 9/13 |
| Pruebas ocultas | 28/33 | **33/33** | **33/33** | 33/33 | **33/33** | 27/33 |
| Convención respetada (RangeError) | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | **3/9** |
| Ejecuciones | 13 | 9 | 9 | 9 | 8 | 7 |
| Tokens sin caché | 358.167 | 280.799 | 281.993 | 281.396 | 271.406 | 237.247 |
| Tokens leídos de caché | 1.958.505 | 1.612.267 | 1.706.866 | 1.659.567 | 1.907.539 | 1.708.274 |
| Tokens de salida | 83.393 | 85.124 | 84.599 | 84.862 | 89.098 | 79.409 |
| **Costo ponderado** | **554 k** | **442 k (−20,2 %)** | **453 k (−18,3 %)** | **447 k (−19,3 %)** | **462 k (−16,6 %)** | **408 k (−26,3 %)** |
| Tiempo del motor | 6,2 min | 6,0 min | 5,9 min | 6,0 min | 6,4 min | 5,8 min |
| Acciones denegadas | 0 | 1 | 0 | — | 1 | 1 |
| Intervenciones humanas | 0 | 0 | 0 | 0 | 0 | 0 |

### Qué agrupó el piloto

| | Ejecuciones |
| :--- | :--- |
| G3a, G3b | 201 · **202+204** · 203 · 205 · **206+207** · **208+209** · **210+211** · 212 · 213 |
| G3r | 201 · **202+204** · 203 · 205 · **206+207** · **208+209** · **210+211** · **212+213** |
| G4 | 201 · **202+203** · **204+205** · **206+207+208** · 209 · **210+211+212** · 213 |

Con tamaño 3 y tope de 6 criterios, el piloto hizo 9 ejecuciones (no las 6 del escenario agrupado a mano) por tres motivos: TASK-201 va sola siempre (primera tarea del proyecto y fija la convención; a mano iba con 202); TASK-203 (4 criterios) y TASK-205 (3) no caben con nadie bajo el tope de 6; y TASK-213 quedó sola porque su resumen *menciona* la convención («según la convención») aunque no la fija. Las reglas afinadas corrigen lo tercero (212+213 fueron juntas en G3r) y hacen el tope proporcional al tamaño (2 por tarea: 6 para grupos de 3, 8 para grupos de 4).

### Pruebas ocultas por tarea

| Tarea | Base | G3a | G3b | G3r | G4 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| TASK-201 Prioridad de tareas | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| TASK-202 Fecha límite | 4/4 | 4/4 | 4/4 | 4/4 | 2/4 ✗ |
| TASK-203 Etiquetas | 4/4 | 4/4 | 4/4 | 4/4 | 3/4 ✗ |
| TASK-204 Eliminar tareas | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| TASK-205 Renombrar tareas | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| TASK-206 Filtros combinables | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| TASK-207 Ordenar tareas | 1/3 ✗ | 3/3 | 3/3 | 3/3 | 3/3 |
| TASK-208 Tareas vencidas | 1/2 ✗ | 2/2 | 2/2 | 2/2 | 1/2 ✗ |
| TASK-209 Resumen por prioridad | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| TASK-210 Guardar y cargar | 0/2 ✗ | 2/2 | 2/2 | 2/2 | 2/2 |
| TASK-211 Exportar a CSV | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| TASK-212 Importar desde CSV | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| TASK-213 Validar datos externos | 3/3 | 3/3 | 3/3 | 3/3 | 1/3 ✗ |

### Por ejecución (costo ponderado)

| Base | | G3a | | G3b | | G3r | | G4 | |
| :--- | ---: | :--- | ---: | :--- | ---: | :--- | ---: | :--- | ---: |
| 201 | 24 k | 201 | 21 k | 201 | 28 k | 201 | 29 k | 201 | 20 k |
| 202 | 27 k | 202+204 | 36 k | 202+204 | 36 k | 202+204 | 35 k | 202+203 | 55 k |
| 203 | 35 k | 203 | 46 k | 203 | 45 k | 203 | 46 k | 204+205 | 39 k |
| 204 | 28 k | 205 | 32 k | 205 | 35 k | 205 | 38 k | 206+207+208 | 90 k |
| 205 | 34 k | 206+207 | 52 k | 206+207 | 60 k | 206+207 | 45 k | 209 | 33 k |
| 206 | 39 k | 208+209 | 52 k | 208+209 | 47 k | 208+209 | 73 k | 210+211+212 | 81 k |
| 207 | 45 k | 210+211 | 84 k | 210+211 | 61 k | 210+211 | 62 k | 213 | 85 k |
| 208 | 53 k | 212 | 50 k | 212 | 53 k | 212+213 | 130 k | | |
| 209 | 34 k | 213 | 66 k | 213 | 84 k | | | | |
| 210 | 68 k | | | | | | | | |
| 211 | 45 k | | | | | | | | |
| 212 | 54 k | | | | | | | | |
| 213 | 59 k | | | | | | | | |

## Lectura

- **Con grupos de 3, la agrupación ahorra entre un 17 % y un 20 % del costo ponderado sin perder calidad.** Tres corridas, 33/33 pruebas ocultas y 9/9 de la convención en todas; la base de 13 ejecuciones sacó 28/33 esta vez (las tres fallas son la deriva conocida de haiku: exigir el objeto de opciones donde la prueba espera un valor por defecto en `sort`, `overdue` y `save`; no tiene que ver con agrupar y en la séptima medición la base sacó 31/33). El tiempo del motor no cambia.
- **Es menos que el −42 % del escenario agrupado a mano, y la diferencia está explicada:** a mano eran 6 ejecuciones, incluida la tarea de la convención junto con la siguiente; el piloto hace 8 o 9 porque respeta sus salvaguardas (la convención sola, tope de criterios). El ahorro por ejecución eliminada es el mismo orden de magnitud: unos 25–30 k ponderados cada una.
- **Con grupos de 4 el ahorro sube al 26 % y la convención se pierde (3/9).** TASK-202 y TASK-203, agrupadas justo después de la tarea que fija la convención, fallaron sus pruebas de `RangeError`; TASK-208 y TASK-213 también. Es exactamente el riesgo que la séptima medición señalaba: un grupo más grande diluye las convenciones recién fijadas. **No conviene subir el tamaño por defecto de 3.** Una sola corrida, pero la señal es clara y en la dirección prevista.
- **Las reglas afinadas** no cambiaron la calidad (33/33, 9/9) y juntaron 212+213, pero esa ejecución salió cara (130 k); el ahorro total de G3r quedó en 16,6 %, dentro del rango de G3. Se conservan por ser correctas (una tarea que solo *sigue* una convención no es una tarea que la fija, y el tope de criterios debe crecer con el grupo), no por el costo.
- **Sigue sin ser estadística:** 4 corridas agrupadas y 1 base, un escenario, un modelo. Sirven para decidir el valor por defecto, no para prometer un porcentaje.

## Decisión sobre el criterio 2 de la Etapa 0

El plan pedía «al menos un 30 % por debajo de `workspace` en la misma corrida, calidad no peor». La calidad se cumple con margen; el 30 % **no**: el piloto agrupando solo ahorra ~19 % (rango 17–20 %) con tamaño 3. El 30 % venía del escenario agrupado a mano, que no respeta las salvaguardas. Opciones:

1. **Dejar la opción desactivada por defecto** (lo que dice el plan si no se alcanza el 30 %), documentando el −19 % medido.
2. **Activarla por defecto con tamaño 3**, porque cuesta menos sin perder calidad ni intervenciones, y el usuario ya decidió apostar por autonomía antes que por costo.

Se recomendó la opción 2 y **el usuario la tomó** (2026-11-11, delegando en el criterio del asistente): activa por defecto con tamaño 3 en features nuevas; las features con autonomía guardada antes de la opción conservan su valor. Tamaño 4 o más: solo con medición propia del proyecto; el panel lo permite y lo advierte.

## Reglas

Tal como quedaron en `src/shared/task-grouping.ts` tras esta medición (decisión 5 de la Etapa 0, ajustada):

- misma feature; tareas `READY`, o `BLOCKED` solo por tareas del propio grupo;
- como máximo `maxGroupSize` tareas (3 por defecto) y `2 × maxGroupSize` criterios de aceptación en total;
- la primera tarea del proyecto va sola;
- va sola la tarea que **fija** una convención: título o resumen con «a partir de esta tarea», «convención del proyecto» o «fija/establece/define (la) convención»; mencionarla no cuenta;
- una tarea con reintento pendiente conserva su grupo;
- orden por dependencias y, a igualdad, por clave.

## Reproducir

```bash
npm run build:core
node scripts/benchmark/run-benchmark.mjs --scenario todo-v2 --base ~/Documents/repos/todo-app --ref 2d321f6 --model haiku --arms workspace,workspace-grouped --out <dir>
node scripts/benchmark/run-benchmark.mjs --scenario todo-v2 --base ~/Documents/repos/todo-app --ref 2d321f6 --model haiku --arms workspace-grouped --group-size 4 --out <dir>
```

Sin `--workspace`/`--project` el harness crea un proyecto nuevo con los perfiles y la política por defecto; `raw.json` guarda tokens por tarea y pruebas ocultas por tarea.
