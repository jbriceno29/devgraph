# Repositorio existente: que la app entre a un proyecto avanzado sin romperlo ni empezar de cero

Fecha: 2026-11-12 · Rama: `feat/claude-code` · Orden en [HOJA_DE_RUTA.md](HOJA_DE_RUTA.md) (plan **REP**).

Origen: con la carpeta de proyectos (`399d0b8`), «Ya tengo el código» hace muy fácil conectar un
repositorio avanzado. La revisión de qué pasa después mostró que la app entra a ese proyecto como si
estuviera vacío: no sabe qué existe, no comprueba que la verificación funcione y aplica rutas de
escritura pensadas para un proyecto nuevo. Este plan define cómo debe incorporarse un repositorio con
historia.

## 1. Qué pasa hoy

Datos tomados del código: `repository-scanner.ts`, `inception-contract.ts`, `foundation-plan.ts`,
`sqlite-change-set-applier.ts`, `execution-validator.ts` y `graph-traversal.ts`.

**Lo que ya funciona (Etapa V4 de [PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md](PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md)):**

- **El escaneo.** Si el proyecto tiene repositorio con código al pulsar «Empezar», el asistente lee:
  - manifiestos, README, CI y estilos;
  - la estructura de carpetas (`topLevel` y `directories`, hasta 3 niveles).

  No lee código fuente. Respeta `.gitignore`, omite secretos y enlaces, y se limita a 48 KB.
- **Lo que deduce, con evidencia.** Stack, sistema de diseño, estructura y pruebas, cada cosa con los
  archivos que la respaldan. El usuario lo ve en «Lo que se detectó en tu repositorio» y lo corrige.
- **La propuesta.**
  - Mantiene el stack (ADR «mantener») sin dependencias nuevas.
  - Registra las convenciones como reglas.
  - Usa el comando de pruebas que ya define el proyecto.
  - Su primera tarea revisa y documenta la base, en lugar de crear un scaffold.

**Lo que falla o falta:**

| # | Problema | Evidencia | Efecto |
| --- | --- | --- | --- |
| P1 | **Las rutas escribibles son las de un proyecto nuevo.** Un proyecto existente no tiene perfil de stack, así que se queda con `src/**`, `tests/**` y `docs/**`. | `sqlite-change-set-applier.ts:310` solo amplía las rutas con el perfil del catálogo. `execution-validator.ts:62` marca como violación todo lo que no está en `writablePaths` y lo revierte. | En un proyecto con `app/`, `components/`, `lib/`, `pages/`, `server/` o configuración en la raíz, el trabajo del agente se revierte al auditar. La tarea falla o el piloto se queda esperando, sin una causa visible. |
| P2 | **La verificación nunca se prueba antes de empezar.** `npm test` se toma del `package.json` sin ejecutarlo. | La propuesta solo copia el script. | Si las pruebas ya fallan en `main`, ninguna ejecución pasa la verificación y el piloto no acepta nada. Se descubre después de gastar ejecuciones. |
| P3 | **El grafo no sabe qué existe.** El plan solo contiene trabajo futuro, y los nodos de código aparecen únicamente cuando una ejecución toca un archivo. | `CODE_REFERENCE` y `MODIFIES` se crean al aceptar una ejecución (Etapa 2 del plan de trabajo). | El contexto de una tarea no puede señalar «el carrito está en `src/cart/`». Cada agente explora desde cero, y el planificador puede proponer lo que ya existe porque solo vio la estructura. |
| P4 | **Las preguntas son las de un proyecto nuevo** (quién lo usa, qué problema resuelve). | `inception-contract.ts:152` usa el mismo guion de preguntas con o sin repositorio. | En un proyecto avanzado lo que importa es el siguiente hito. |
| P5 | **Un proyecto que ya tiene plan no puede volver al inicio** y el trabajo hecho fuera de la app no se detecta. | El inicio rechaza proyectos con features o tareas (`GUIA_DE_USO.md`, «Lo que todavía no hace»). | El grafo se desincroniza si el usuario programa a mano o con otro agente. Va contra el principio «el grafo se mantiene solo». |

## 2. Comportamiento objetivo

Incorporar un repositorio son cuatro pasos antes del plan, y un mantenimiento continuo después:

```text
escaneo (hoy) ─► R1 rutas y comandos ─► R2 línea base ─┐
                                                        ├─► R4 preguntas del siguiente hito ─► propuesta
                         R3 mapa de lo existente ───────┘   (el mapa corre mientras el usuario responde)
después: R5 detectar el trabajo hecho fuera de la app y «Poner al día el proyecto»
```

**Principios:**

- **Primero lo barato y determinista.** R1 y R2 no usan modelo: leen el repositorio y ejecutan comandos
  que ya existen. El modelo solo entra en R3 y R4.
- **Todo se propone, nada se impone.** Rutas, verificación y mapa llegan como propuesta que el usuario ve y
  corrige, igual que las inferencias de hoy. Lo que corrige el usuario manda.
- **El mapa es evidencia, no opinión.** Cada módulo o capacidad que se marca como existente cita archivos
  reales. La app descarta lo que no tenga respaldo, como hace hoy `normalizeInferences`.
- **Solo lectura hasta aprobar.** Antes de aprobar no se escribe nada en el repositorio. R2 corre en una
  copia aislada (worktree), como las ejecuciones.

## 3. Etapas

### R1. Rutas escribibles y comandos derivados del repositorio (S, ½ día)

- **Rutas derivadas del escaneo, sin modelo.** Se calculan a partir de `topLevel` y `directories`:
  - carpetas de código: toda carpeta de la raíz con archivos de lenguaje, salvo las generadas y `docs/`;
  - carpetas de pruebas;
  - archivos de configuración de la raíz que el stack necesita tocar (`package.json`, `tsconfig*.json`,
    `vite.config.*`, `next.config.*`, `tailwind.config.*`…).

  Las prohibidas se mantienen (`.env*`, `.git/config`). Las de solo lectura, `docs/architecture/ADR/**`.
- **Comandos de verificación propuestos,** según los scripts existentes y en este orden: `test`, y luego
  `typecheck`/`lint`/`build` si están definidos.
- **Dónde lo ve el usuario:** «Lo que se detectó en tu repositorio» suma la sección «Qué podrá tocar el
  agente», con las rutas, una explicación de cada una y la opción de quitar o añadir.
- **Al aprobar,** la operación de perfil de la propuesta guarda las rutas (aceptadas o corregidas) en la
  política, igual que hoy hace con `stackProfileId`.
- **Para proyectos existentes ya creados:** en Ajustes › Política, un botón «Proponer rutas desde el
  repositorio» que hace el mismo cálculo.

**Cierre:**
- Pruebas: el escaneo de un repositorio Next (`app/`, `components/`, `lib/`, `next.config.mjs`) da esas rutas,
  y una ejecución que escribe en `app/` no se revierte.
- Corrida real con `haiku` sobre un repositorio de `~/Documents/repos` con código fuera de `src/`.

**Estado de R1 (2026-11-12): hecho.**

- `src/domain/projects/agent-access.ts` calcula, sin modelo, las rutas (carpetas de código y de pruebas de la raíz, configuración de la raíz y las salidas que genera la app) y las comprobaciones (`test`, `typecheck`, `lint`, `build`, con `pnpm` si hay `pnpm-lock.yaml`; omite el `test` de relleno de npm).
- El inicio las muestra en «Qué podrá tocar el agente» (`AgentAccessSection.tsx`): se puede quitar, añadir y volver a lo detectado.
- La edición viaja con las respuestas (`access`) y la propuesta la guarda en `SET_PROJECT_PROFILE.writablePaths`. Al aprobar, esas rutas sustituyen a las de un proyecto nuevo.
- En Ajustes › Política, «Proponer rutas desde el repositorio» (`policy:propose_from_repository`) rellena el formulario sin guardar.
- Pruebas: `tests/unit/agent-access.test.ts`, `tests/integration/agent-access.test.ts` (repositorio Next; una ejecución que escribe en `app/` pasa con las rutas derivadas y se revierte con las de siempre) y `tests/ui/agent-access.test.tsx`.
- Corrida real con `haiku` sobre una copia de `salestify-web` (`app/`, `core/`, `modules/`, sin `src/`): la tarea escribió `core/format-price.js` y se completó sin reversión.
- Inicio real con `sonnet` (elegible en el selector del asistente o con `model` en `inception:start`) sobre una copia de `salestify-web`: inferencias con evidencia, «Qué podrá tocar el agente» con las rutas del repositorio, la edición (quitar `e2e/**`, añadir `server/**`, solo `npm test`) se guardó tal cual en la política al aprobar; 0,31 USD. La primera tarea de «Fundación» con `haiku` se completó sin reversión.
- Corrección tras esa corrida: `docs/**` entra siempre en las rutas propuestas (motivo «documentación»; los ADR siguen de solo lectura), porque la «Fundación» de un repositorio existente documenta la base.
- **Hecho en C6:** `npm run build` ya no es comprobación por tarea, salvo que sea la única; corre una vez al integrar la feature. **Pendiente en C2:** R1 detecta las variables que el código espera (`.env.example`, `process.env.*`) y las pide como secretos del proyecto.

### R2. Línea base de verificación (M, 1 día)

- **Antes de la propuesta,** en una copia aislada de la rama actual:
  - instalar las dependencias con el mecanismo actual (npm o pnpm, sin scripts);
  - correr una vez los comandos de verificación propuestos.
- **Resultado guardado y visible:**
  - por comando: pasa o falla, duración, y las últimas líneas de la salida;
  - un resumen («`npm test`: pasan 48, fallan 3»).
- **Si algo falla:**
  - la propuesta empieza con la tarea «Dejar la verificación en verde», en la feature «Fundación»;
  - el usuario puede elegir «Aceptar estos fallos como conocidos»: el comando se excluye de la verificación
    hasta que esa tarea lo arregle, y queda anotado en las reglas;
  - el piloto no se puede activar mientras la verificación de la rama base no esté en verde (aviso con el
    motivo y un enlace a la tarea).
- **Reutiliza C6** ([PLAN_CAPACIDADES_DEL_AGENTE.md](PLAN_CAPACIDADES_DEL_AGENTE.md)): un límite de tiempo
  por comando y el resultado de cada comprobación por separado. Por eso R2 va después de C6.

**Cierre:**
- Pruebas: un repositorio con una prueba rota da la tarea «Dejar la verificación en verde» y bloquea el piloto.
- Corrida real con `todo-app` (en verde) y con una copia con una prueba rota.

**Estado (2026-11-12): hecho.**

- **Línea base:** se guarda por proyecto.
  - Corre en segundo plano sobre una copia de la rama base (en `checks/`, como C6), con la instalación habitual y los límites de tiempo de C6. Nunca usa la rama que el usuario tenga abierta.
  - Muestra cada comprobación con su recuento (Vitest, Jest, `node:test` y pytest), su duración y el final de la salida.
  - En el inicio de un repositorio existente arranca sola al aparecer «Qué podrá tocar el agente», con las comprobaciones que haya en pantalla. En Ajustes se puede volver a comprobar.
- **Si algo falla:**
  - La propuesta empieza con «Dejar la verificación en verde», con prioridad crítica, en «Fundación». Lleva el final de la salida y un criterio por comando.
  - El piloto no arranca y explica el motivo.
- **«Aceptar estos fallos como conocidos»:**
  - Saca esos comandos de la política, o de la propuesta si aún no se aprobó, y los anota en las reglas. El piloto puede arrancar.
  - La línea base los sigue corriendo. Cuando vuelven a pasar, o el usuario deja de aceptarlos, vuelven a la verificación.
- **Corrida real con `haiku`** sobre copias de `todo-app`, con el usuario en otra rama:
  - **En verde:** «`npm test`: pasan 40» en 1 s, y la propuesta no cambia.
  - **Con una prueba rota:**
    1. La línea base dio «pasan 39, fallan 1» y bloqueó.
    2. La propuesta empezó con «Dejar la verificación en verde» (TASK-001) y el piloto se rechazó con el motivo.
    3. Al aceptar el fallo, la política quedó sin `npm test` y el piloto se desbloqueó.
    4. Al volver a comprobar, la línea base siguió corriendo `npm test`.
  - La primera corrida reveló que aceptar un fallo después de aprobar no lo sacaba de la política. Ya está corregido.
- **Pendiente:** «Poner al día el proyecto» (R5) repetirá la línea base sobre el estado actual.

### R3. Mapa de lo que existe (L, 2–3 días)

- **Una ejecución de reconocimiento en solo lectura:**
  - herramientas `Read`, `Glob` y `Grep`; sin escritura ni comandos;
  - salida estructurada (`--json-schema`), modelo `haiku` y tope de turnos;
  - corre en un worktree, como cualquier ejecución.
- **Devuelve un inventario con evidencia:**
  - módulos;
  - capacidades que ya funcionan, por módulo, con su estado (`COMPLETA` o `PARCIAL`) y sus archivos;
  - puntos de entrada, organización de las pruebas y pendientes visibles (`TODO`, funciones a medias).
- **La app lo convierte en una propuesta normal (ChangeSet):**
  - módulos y features existentes, en estado «Hecha» o «Parcial»;
  - un `CODE_REFERENCE` por archivo de evidencia, con su arista;
  - el documento `docs/MAPA_DEL_CODIGO.md`, enlazado a los módulos con `DOCUMENTED_BY`, para que entre al
    contexto (nivel 3).

  Las rutas que no existen en `git ls-files` se descartan, y una capacidad sin evidencia no entra.
- **Contexto.** Una tarea nueva bajo un módulo existente recibe los punteros (nivel 4) a los archivos de
  ese módulo. Hoy solo los recibe de sus dependencias y de las tareas terminadas de su feature.
  Corresponde a `graph-traversal.ts` (`context/` tras A2).
- **Sustituye a la primera tarea de hoy** («revisar y documentar la base»): el README y la prueba de humo
  pasan a ser una tarea normal, solo si faltan.
- **Corre en paralelo a las preguntas (R4),** y la propuesta lo espera. El usuario ve su progreso.
- **Validar en el validador de ChangeSets** que se admiten features en «Hecha» creadas por propuesta, y
  `CODE_REFERENCE` creados fuera de una ejecución (procedencia nueva `SURVEY`).

**Cierre:**
- **Benchmark** con el formato de `docs/benchmarks/`: tres tareas sobre un repositorio real, con y sin mapa.
  Medidas: aceptadas al primer intento, turnos de exploración antes del primer cambio, código duplicado o
  contradicho, y tokens.
- **Criterio de corte:** si el mapa no reduce la exploración ni los errores por desconocer el código, R3 se
  queda en el documento `MAPA_DEL_CODIGO.md`, sin nodos en el grafo.

**Estado (2026-11-12): hecho.**

- **Reconocimiento:** al leer el repositorio en «Empezar», arranca en segundo plano mientras el usuario responde.
  - `claude -p --json-schema` con `haiku`, `Read`, `Glob` y `Grep` limitados a una copia de la rama base (`withBaseCheckout`, compartido con R2) y 40 turnos como mucho.
  - Corre con `--setting-sources ''`: la comprobación con la CLI mostró que con `project,local` los hooks del `.claude/settings.json` del repositorio sí se ejecutan.
  - Cada ruta se contrasta con `git ls-files` de ese commit. Se descartan las que no existen, las capacidades sin evidencia y los módulos vacíos.
- **Vista:** «Lo que se detectó en tu repositorio» muestra el avance (leyendo, listo con el recuento, o el error). Un mapa que la app dejó a medias se lee como interrumpido y se repite al preparar la propuesta. Si falla, la propuesta se hace sin mapa.
- **Propuesta:**
  - Espera al mapa y lo recibe como datos, con los ids de sus módulos y capacidades.
  - Solo añade trabajo nuevo, colgado de esos módulos. Una capacidad a medias se completa con tareas bajo su feature.
  - «Fundación» pasa a ser opcional y ya no hay tarea de «revisar y documentar la base».
  - La revisión muestra «Lo que ya existe» aparte del «Trabajo nuevo».
- **Grafo:** al aprobar entran los módulos, las capacidades (features en «Hecha» o «Parcial», estado nuevo), un `CODE_REFERENCE` por archivo de evidencia (operación nueva `CREATE_CODE_REFERENCE`, que solo construye la app) con `TOUCHES_CODE` desde su capacidad y su módulo, y `docs/MAPA_DEL_CODIGO.md` con `DOCUMENTED_BY` desde cada módulo.
  - La procedencia `SURVEY` va en `metadata.origin` de la arista: la columna `provenance` tiene un `CHECK` que obligaba a reconstruir `graph_edges`.
- **Contexto:** una tarea bajo un módulo existente recibe sus archivos como punteros de nivel 4 (`code-pointers.ts`, como mucho 40), la feature antes que el módulo.
- **Corrida real con `haiku`** sobre una copia de `todo-app`, con el usuario en otra rama:
  - Mapa en 14 s: un módulo con 7 capacidades, cada una con `src/tasks.js` y su prueba.
  - La propuesta trajo solo trabajo nuevo y, al aprobar, quedaron 7 features «Hecha», 2 `CODE_REFERENCE`, 16 `TOUCHES_CODE` y el documento.
  - La primera tarea recibió `src/tasks.js` y `tests/tasks.test.js` como punteros, y el mapa como documento.
  - La primera corrida reveló dos cosas, ya corregidas: aprobar fallaba cuando el modelo ponía la visión bajo la raíz y además la arista `DOCUMENTED_BY` explícita (ahora una arista repetida no se crea dos veces), y el prompt tomaba las pruebas por un módulo y anotaba como pendiente que no había pendientes.
- **Benchmark** ([2026-11-12-tienda-existente-haiku-mapa.md](benchmarks/2026-11-12-tienda-existente-haiku-mapa.md)), tres tareas sobre una tienda existente, con y sin mapa:
  - Misma calidad: 3 de 3 al primer intento, 6/6 pruebas ocultas y reutilización del código existente en los dos brazos.
  - Exploración antes del primer cambio: de 30 a 16 llamadas a herramientas.
  - Un 10 % más de costo ponderado en tokens.
  - Por el criterio de corte, los nodos se quedan en el grafo.
- **Pendiente:**
  - Medir en un repositorio grande si el mapa también evita errores (con R5).
  - Las preguntas siguen siendo las de un proyecto nuevo (R4).

### R4. Preguntas del siguiente hito (S, ½ día)

- **Con repositorio, el guion de preguntas cambia.** En vez de «quién lo usa / qué problema resuelve»:
  - ¿qué quieres lograr ahora? (una feature, terminar algo a medias, deuda técnica, migrar);
  - ¿qué no se debe tocar?;
  - ¿cuándo cuenta como terminado este hito?

  La visión del producto se infiere del README y del mapa, y se muestra para que el usuario la corrija.
- **La propuesta contiene solo trabajo nuevo,** colgado de los módulos del mapa. Cuando una capacidad
  aparece como parcial, la tarea dice «completar» y no «crear».

**Cierre:**
- Prueba del prompt con un repositorio con mapa.
- Corrida real: el plan no contiene nada que el mapa marque como hecho.

### R5. El grafo al día con el repositorio (M, 1–2 días)

- **Detectar el trabajo hecho fuera de la app.** Al abrir el proyecto, y cada cierto tiempo con la app
  abierta, se buscan commits en la rama base que no vienen de una integración de la app.
  - **Aviso** en la Bandeja: «3 commits fuera de la app tocaron `src/cart/`».
  - **Acción:** «Actualizar el mapa», que repite R3 solo sobre los archivos cambiados y lo presenta como
    propuesta.
- **«Poner al día el proyecto»** para proyectos que ya tienen plan:
  - repite R1 (rutas), R2 (línea base) y R3 (mapa, incremental) sobre el estado actual;
  - propone los cambios en Planificar, sin rehacer el plan ni tocar tareas abiertas.

  Cubre lo que hoy figura como «Replanificar un proyecto que ya tiene plan» en «Lo que todavía no hace».
- **Necesita F1** de [AUDITORIA_UX.md](AUDITORIA_UX.md): acciones en línea en la Bandeja, y la vista
  «Proyecto», donde vive el botón.

**Cierre:**
- Pruebas con commits hechos a mano entre dos aperturas.
- Corrida real: modificar `todo-app` fuera de la app y comprobar el aviso y la propuesta.

## 4. Dónde vive el código (según [PROPUESTA_ARQUITECTURA.md](PROPUESTA_ARQUITECTURA.md))

| Etapa | Módulo |
| --- | --- |
| R1 | `projects/` (cálculo de rutas a partir del escaneo, en `domain/`, puro) y `inception/` (sección de la vista). |
| R2 | `environment/` (instalar y ejecutar en un worktree; reutiliza la ejecución de comandos de C6). |
| R3 | `inception/` (caso de uso `survey-repository`, prompt en `prompts/survey.md`), `knowledge/` (procedencia `SURVEY` en el validador) y `context/` (punteros por módulo). |
| R4 | `inception/` (`prompts/questions-brownfield.md`). |
| R5 | `activity/` (aviso), `projects/` (comparar la rama base con las integraciones de la app) e `inception/` (mapa incremental). |

Si una etapa se hace antes de A2, su código va en la carpeta de hoy y A2 lo mueve con lo demás.

## 5. Qué no se hace

- **Leer todo el código en el escaneo.** El escaneo de R1 sigue siendo de metadatos y 48 KB. La lectura de
  código fuente solo la hace el agente de R3, con sus herramientas y un tope, como cualquier ejecución.
- **Ejecutar scripts arbitrarios del repositorio en R2.** Solo los comandos de verificación propuestos y
  aceptados, con el mismo entorno limpio de las ejecuciones (sin `postinstall`).
- **Importar issues, PRs o el historial de Git como tareas.** Queda fuera hasta que existan los conectores
  (C4).
