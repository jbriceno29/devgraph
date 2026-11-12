# DIS D0 · Medición base de las direcciones visuales

Fecha: 2026-11-12 · Rama: `roadmap/dis-d0-baseline` (desde `feat/claude-code` en `a93a3c9`) · Plan:
[PLAN_DISENO_VISUAL.md](../PLAN_DISENO_VISUAL.md#d0--medición-base-s-2-h)

Esta es la línea base con la que se compararán D1–D3. El código de la app no cambia en D0.

## Cómo se midió

- Script: `~/.cache/graphdev2-real-runs/scripts/dis-d0-baseline.mjs`. Maneja `dist/main/sidecar.js` sobre 3 proyectos
  de prueba nuevos, con un repositorio vacío cada uno.
- Las preguntas se generaron con `haiku` y se contestaron con la opción sugerida. La puerta de diseño elige su propio
  modelo con `uiModel`: `sonnet`, porque estaba disponible.
- Las 3 exploraciones corrieron en paralelo.
- Capturas con el Chrome del sistema en modo headless (`dis-d0-shots.mjs`), a 1440×900 y a 390×844, bajo la misma CSP
  que el visor de la app. Aquí se guardan las de escritorio, en [dis-d0/](dis-d0/).

| Brief | Registro buscado |
| --- | --- |
| `soporte` | Panel interno de tickets con SLA, usado 8 horas al día: denso y calmo. |
| `menu` | Menú semanal familiar con lista de compras compartida: cálido y doméstico. |
| `lectura` | Retos de lectura para niños de 8 a 11 años, con vista para los padres: lúdico. |

## Números

| Brief | Tiempo de diseño | Tokens de salida | Costo (preguntas + diseño) | Caracteres por prototipo |
| --- | --- | --- | --- | --- |
| `soporte` | 210 s | 37 579 | 0,38 USD | 15 203 · 16 693 · 15 254 |
| `menu` | 285 s | 49 433 | 0,50 USD | 13 408 · 14 726 · 14 368 |
| `lectura` | 235 s | 40 317 | 0,40 USD | 15 364 · 17 937 · 16 408 |

- Los 9 prototipos corrieron sin errores de JavaScript visibles y con datos realistas en español.
- Dos superaron el tope de 16 000 caracteres que pide el prompt (16 693 y 17 937). El tope no se valida; solo se
  pide.

## Rúbrica

| Dirección | Arquetipo | Tipografía | Rasgos genéricos |
| --- | --- | --- | --- |
| `soporte` ui-1 «Cola densa lateral» | Barra lateral clara + tabla | `system-ui` y `monospace` | Kit SaaS: azul `#1F4FD8`, píldoras, botones con borde en cada fila. |
| `soporte` ui-2 «Tablero de flujo» | Tablero oscuro por columnas | `system-ui` y `monospace` | Fondo casi negro con un acento turquesa brillante, etiquetas en mayúsculas espaciadas, «D0 · SOPORTE». |
| `soporte` ui-3 «Bandeja con detalle» | Lista + detalle | Georgia y `system-ui` | Papel crema con acento terracota `#8A3B12` y serif. El panel de detalle abre vacío y ocupa media pantalla. |
| `menu` ui-1 «Cocina de casa» | Columna de tarjetas | Georgia y `system-ui` | Crema `#FFF8EF` + terracota `#B93C0B` + serif; tarjetas idénticas. |
| `menu` ui-2 «Panel de planificación» | Barra lateral oscura + tabla | `system-ui` y `monospace` | Kit SaaS: barra azul marino, tres tarjetas de cifras, cabeceras en mayúsculas. |
| `menu` ui-3 «Mesa familiar» | Tarjetas con sombra dura | `system-ui` en peso 900 | La más personal (verde bosque y amarillo, estilo pegatina), pero la vista inicial ocupa un tercio de la pantalla. |
| `lectura` ui-1 «Mapa de aventuras» | Columna de tarjetas | Trebuchet y Segoe | La única pensada para niños. Aun así es una lista de filas iguales con el mismo botón violeta, sin nada del mundo de la lectura. |
| `lectura` ui-2 «Cuaderno tranquilo» | Lector centrado | Georgia y `system-ui` | Papel crema con terracota `#8A3B12` y serif: el mismo hex que `soporte` ui-3. Mucho vacío y tipografía pequeña para niños. |
| `lectura` ui-3 «Panel familiar» | Barra lateral oscura + tarjetas de cifras | `system-ui` | Kit SaaS: azul marino `#12263A`, «MATEO · RACHA» en mayúsculas, la mitad de la pantalla vacía. |

## Hallazgos

1. **Las tres direcciones son los mismos tres arquetipos sea cual sea el brief.** En los tres briefs salió:
   - un panel SaaS (barra lateral oscura o clara, tabla y tarjetas de cifras);
   - una versión «cálida» con papel crema, terracota y Georgia;
   - una tercera más audaz.

   El registro sale de una plantilla, no del tema. El mismo `#8A3B12` aparece en dos proyectos sin relación.
2. **Los defaults dominan.** 7 de 9 caen en algún rasgo de la lista de `frontend-design`: el crema con terracota y
   serif, el fondo oscuro con acento brillante, el kit de tarjetas SaaS, las etiquetas en mayúsculas o los textos
   unidos con «·».
3. **La variedad es de layout, no de identidad.** Se cumple lo que pide el prompt («distintas en estructura»): lista,
   tablero, columna y vista dividida. Pero ninguna tiene una metáfora reconocible ni un elemento memorable.
4. **No hay tipografía con intención.** Siempre es `system-ui` con, a lo sumo, Georgia o `monospace`. No hay escala
   tipográfica trabajada ni un titular usado como elemento visual.
5. **El piso funcional se ve en la pantalla.** Las 9 direcciones tienen el mismo pie con «Simular error» y la lista de
   atajos, y cada fila tiene botones «Editar»/«Eliminar». Cumple `UI_RULES`, pero ensucia la primera impresión y hace
   que todas se parezcan.
6. **La primera vista está poco cuidada.** En 4 de 9, la vista inicial ocupa menos de la mitad de la pantalla o abre
   un panel vacío.
7. **El contenido es bueno.** Los datos son creíbles, el español es natural y las pantallas son las correctas. Eso hay
   que conservarlo.

## Qué debe mejorar D1–D3 frente a esta base

- En cada brief, las 3 direcciones se distinguen por identidad y no solo por layout. Ningún hex ni arquetipo se
  repite entre briefs sin una razón del tema.
- Como mucho 1 de cada 3 direcciones usa uno de los rasgos genéricos, y solo cuando el concepto lo justifica.
- Cada dirección declara una metáfora y un elemento memorable que se reconozcan en la captura.
- La vista inicial llena la pantalla con la tarea principal. «Simular error» y la lista de atajos no compiten con el
  contenido.
- Tiempo de reloj ≤ 285 s y costo medido; hoy son 0,38–0,50 USD por proyecto.
