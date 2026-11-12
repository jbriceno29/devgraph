# Propuesta de arquitectura: monolito modular por contextos + MVVM en la interfaz

Fecha: 2026-11-12 · Rama: `feat/claude-code` (commit `5d0355b`) · Estado: **propuesta, sin ejecutar**

## 1. Para qué existe la app (y por qué eso decide la arquitectura)

Graph Workspace lleva un proyecto de software de la idea al código con agentes de IA **sin que el usuario orqueste**: el proyecto vive como un grafo (SQLite + Markdown en Git), cada tarea se ejecuta con el contexto justo en un worktree aislado, se verifica, se acepta y deja su resultado en el grafo para las siguientes; un piloto recorre las features solo. El contexto vive en el workspace, no en el motor, para que la próxima tarea pueda correr con Claude Code o con Codex.

De ahí salen cuatro exigencias para la arquitectura:

1. **Muchos flujos de negocio independientes** (inicio, planificación, contexto, ejecución, piloto, entorno, documentos, actividad) que crecen a ritmos distintos. → Separar por **contexto de negocio**, no por tipo técnico.
2. **Motores intercambiables** (Claude hoy, Codex en la Etapa 4) y Git/SQLite/CLI detrás de todo. → **Puertos y adaptadores** reales, con el ensamblaje en un solo sitio.
3. **Mucha lógica pura y probable** (políticas, puertas del piloto, validación de ChangeSets, siguiente paso). → Dominio y casos de uso sin E/S.
4. **Una interfaz que va a reorganizarse** (auditoría UX, §5). → La lógica de cada pantalla fuera del JSX, para mover pantallas sin reescribirlas.

## 2. Diagnóstico: qué está mal hoy

La intención original era hexagonal (dominio → aplicación → infraestructura con puertos), y en lo pequeño se respeta. El problema es que **creció por acumulación en unos pocos archivos «dios»** y la estructura por capas técnicas obliga a saltar entre 4 carpetas para tocar una sola funcionalidad.

| Medida | Valor |
| :--- | :--- |
| Archivos TS/TSX en `src/` | 166 (28 980 líneas) |
| Archivos > 300 líneas | 21 · > 500: 12 · **> 1000: 4** |
| Líneas > 120 columnas (pese a Biome) | 709 (prompts y SQL en una sola línea; hay líneas de 1 216 caracteres) |
| Pruebas | 75 archivos, 494 pruebas, todas pasan |

**Los cuatro archivos más pesados concentran el 18 % del código:**

| Archivo | Líneas | Qué mezcla |
| :--- | ---: | :--- |
| `application/execution/agent-orchestrator.ts` | 1 541 | Iniciar, aceptar, cancelar, aprobar permisos, revisar, integrar features, sesiones, política, autenticación, desbloqueo de dependencias y construcción de prompts. `start()` mide ~250 líneas; `integrateFeature()` ~180. 11 dependencias en el constructor. |
| `infrastructure/ipc/sidecar/workspace-core.ts` | 1 207 | Raíz de composición + `switch` de **65 canales** + reglas de negocio (aprobar dependencias, selección de skills) + **SQL crudo** (7 `prepare`). 98 imports. |
| `application/inception/project-inception-service.ts` | 1 147 | Todo el asistente de inicio: preguntas, propuesta, exploración visual, importaciones, aprobación, vista. |
| `desktop/presentation/inception/InceptionAssistant.tsx` | 1 004 | Estado, efectos, llamadas IPC y JSX de cinco pasos en un componente. |

**Problemas estructurales (no solo de tamaño):**

- **Raíz de composición con negocio dentro.** `workspace-core.ts` decide reglas (`approveDependencies`, `skillProvision.select` con una consulta SQL de 3 tablas) que deberían ser casos de uso probables.
- **Repositorios y puertos «cajón».** `SqliteAgentExecutionRepository` (912 líneas, ~35 métodos) guarda perfiles, políticas, tareas, dependencias, ramas de feature, resultados de cierre, diffs, aprobaciones y eventos. Su puerto `AgentExecutionRepositoryPort` obliga a cualquier prueba o motor nuevo a implementar todo eso.
- **El dominio depende de los DTO de la interfaz.** `domain/graph`, `domain/knowledge` y `domain/artifacts` importan tipos de `shared/contracts/*-view.ts`; la dirección correcta es la contraria.
- **La aplicación toca Node** (`node:crypto`, `node:path`) en lugar de recibir un reloj/generador de ids.
- **Interfaz sin capa de lógica.** Los componentes llaman a `window.workspaceIpc` directamente (hasta 13 llamadas en `AgentsWorkspace.tsx`), con 14–21 `useState`/`useEffect` por pantalla. Por eso el filtro del grafo pisa el estado global (B1 de la auditoría UX) y cambiar de vista pierde borradores (B4).
- **Textos largos en el código.** Los prompts (`inception-contract.ts`, `change-set-planning-contract.ts`) son cadenas de 1 200 caracteres por línea: ilegibles e imposibles de revisar en un diff.
- **Documentación duplicada.** `ARCHITECTURE.md`, `DOMAIN.md`, `IMPLEMENTATION_PLAN.md` y `PROGRESS.md` describen un diseño anterior; `ARQUITECTURA_ACTUAL.md` lo corrige. No hay `CLAUDE.md`, así que los agentes que trabajan en este repositorio no conocen ninguna regla.

## 3. Opciones evaluadas

| Opción | Encaja | No encaja | Veredicto |
| :--- | :--- | :--- | :--- |
| **N capas clásicas** (controller/service/repository) | Simple de explicar. | Es lo que hay hoy de hecho: los «services» crecen sin límite y una funcionalidad queda repartida en 4 carpetas. | No |
| **DDD completo** (agregados, eventos de dominio, CQRS) | El lenguaje del dominio es rico. | Demasiada ceremonia para un equipo de una persona con agentes; añade conceptos sin quitar peso. | Solo lo útil |
| **Hexagonal / Clean** (puertos y adaptadores) | Motores intercambiables, Git/SQLite/CLI detrás de puertos, lógica pura probable. Ya es la intención del código. | Por sí sola no impide los archivos dios. | **Sí, dentro de cada módulo** |
| **Monolito modular / vertical slices** | Cada contexto (inicio, ejecución, piloto…) en su carpeta, con su API pública; se toca una funcionalidad sin salir de ella. | Requiere reglas de dependencias entre módulos. | **Sí, como eje principal** |
| **MVVM** | Separa estado y efectos (ViewModel) del JSX (View) en React; permite reorganizar pantallas (auditoría UX §5) moviendo vistas sin tocar su lógica. | En el núcleo no tiene sentido (no hay vistas). | **Sí, solo en la interfaz** |

### Recomendación

> **Núcleo: monolito modular hexagonal** — módulos por contexto de negocio, cada uno con `domain/ application/ infrastructure/ ipc/`, un caso de uso por archivo y la composición solo en `bootstrap/`.
> **Interfaz: MVVM por feature** — `View` (JSX) + `ViewModel` (hook con estado y efectos) + `Model` (API IPC tipada y lógica pura), con carpetas por las pantallas que propone la auditoría UX.

## 4. Estructura objetivo

```text
src/
  sidecar.ts                         ← entrada estable del núcleo (Rust ya no cambia de ruta)
  bootstrap/
    container.ts                     ← único sitio con `new` de infraestructura
    ipc-router.ts                    ← une los handlers de cada módulo; serialización por handler
    request-dispatcher.ts
  modules/
    projects/        crear/abrir proyecto, repositorio, catálogo de stacks
    knowledge/       grafo, topología, ChangeSet (aplicar), estado de ADR, inspector
    planning/        planificador, validador, referencias, UI_SPEC
    inception/       asistente de inicio, exploración visual, importaciones
    context/         motor de contexto (resolver, ranking, empaquetado)
    execution/       ejecutar/aceptar/cancelar/revisar, aislamiento Git, validador, gobernanza
    autopilot/       piloto, política de decisiones, agrupación de tareas, métricas
    environment/     dependencias, skills, comandos del proyecto
    documents/       artefactos Markdown, watcher, commit de documentos
    activity/        bandeja
      <módulo>/
        domain/          tipos y reglas puras (sin E/S, sin Node)
        application/     un caso de uso por archivo + ports.ts del módulo
        infrastructure/  adaptadores (sqlite-*, git-*, claude-*)
        prompts/         plantillas .md (solo módulos con IA)
        ipc.ts           handlers de sus canales (parseo de args → caso de uso → DTO)
        index.ts         API pública del módulo
  platform/                          ← piezas técnicas compartidas, sin negocio
    sqlite/          database, migraciones (carpeta única y ordenada), unidad de trabajo
    git/             ejecutor de git
    claude-cli/      ruta del CLI, entorno del hijo, proceso y stream-json
    codex-cli/       desconectado hasta la Etapa 4
    fs/              Markdown atómico y transaccional
    clock.ts, ids.ts
  shared/
    kernel/          vocabulario común (tipos de entidad y arista, estados) — lo usan dominio y contratos
    contracts/       DTO e IPC (importa de kernel, nunca de módulos)
  desktop/
    app/             main.tsx, shell, navegación, proveedores
    core/            ipc (cliente Tauri + bus de eventos), store del proyecto (grafo, selección)
    features/
      inbox/         (hoy Actividad)
      plan/          (hoy Grafo + Planificar + inspector)
      executions/    (hoy Agentes › Ejecutar, Revisión, Comandos)
      documents/
      project/       (hoy Inicio: asistente y ficha del proyecto)
      settings/      (hoy Agentes › Ajustes)
        <feature>/
          FeatureView.tsx          View: solo JSX, recibe todo del ViewModel
          use-feature.vm.ts        ViewModel: estado, efectos, acciones
          feature.api.ts           Model: llamadas IPC tipadas de la feature
          feature.logic.ts         Model: funciones puras (p. ej. next-step)
          components/              piezas de presentación
    ui/              botones, errores, etiquetas (i18n/es.ts), tema
```

Las carpetas de la interfaz usan ya los nombres de la reorganización de la auditoría UX para no mover los archivos dos veces.

### De dónde sale cada pieza grande

| Hoy | Mañana |
| :--- | :--- |
| `agent-orchestrator.ts` (1 541) | `execution/application/`: `start-execution.ts`, `accept-execution.ts`, `cancel-execution.ts`, `request-changes.ts`, `resolve-approval.ts`, `reconcile-interrupted.ts`, `record-outcome.ts`; `execution/domain/task-prompt.ts` (prompt, criterios, política, entorno); `integrate-feature.ts` + `execution/domain/feature-branches.ts`; `update-policy.ts` y `set-auth-mode.ts`. |
| `workspace-core.ts` (1 207) | `bootstrap/container.ts` + un `ipc.ts` por módulo; `approveDependencies`, `setSkills` y la selección de skills a casos de uso de `environment/`; el SQL a `environment/infrastructure/sqlite-project-environment.ts`. |
| `project-inception-service.ts` (1 147) | `inception/application/`: `start-inception`, `answer-questions`, `explore-ui`, `revise-ui-option`, `choose-ui-option`, `import-prototype`, `import-design`, `approve-inception`, `restart-inception`; `inception-view.ts` (mapeo a DTO); `background-call.ts` (llamada en segundo plano y cancelación). |
| `sqlite-agent-execution-repository.ts` (912) | Repositorios por agregado: perfiles y proveedor, política, ejecuciones y eventos, aprobaciones, diffs, resultados de tarea, ramas de feature. Cada caso de uso pide solo el puerto que usa. |
| `feature-pilot.ts` (705) | `autopilot/application/`: `start-pilot`, `stop-pilot`, `resume-pilot`, `pilot-loop.ts` (el bucle, partido en pasos), `acceptance-gates.ts` (puro), `handle-agent-proposal.ts`. |
| `inception-contract.ts`, `change-set-planning-contract.ts` | Prompts en `prompts/*.md`; en el `.ts` solo esquemas JSON y normalización. |
| `InceptionAssistant.tsx` (1 004), `GraphCanvas.tsx` (719), `AgentsWorkspace.tsx` (663), `FeaturePilotPanel.tsx` (547), `PlanningWorkspace.tsx` (521) | Una View + un ViewModel por paso o panel; el filtro del grafo pasa al ViewModel del plan (arregla B1), los borradores al store del shell (B4). |

## 5. Reglas a partir de ahora

Cada regla es comprobable; las marcadas **[auto]** las revisa `npm run check:arch` (script sin dependencias, en `npm test` y en CI).

**Dependencias**

1. **[auto]** Dentro de un módulo: `domain` no importa nada fuera de su `domain` y `shared/kernel`; `application` importa `domain` y sus puertos; `infrastructure` implementa puertos. Nunca al revés.
2. **[auto]** Un módulo solo importa otro por su `index.ts`, y nunca su `infrastructure`. Si dos módulos se necesitan mutuamente, uno expone un puerto y el otro lo implementa.
3. **[auto]** `domain` y `application` no importan `node:*`, `better-sqlite3` ni `child_process`: reciben `Clock`, `IdGenerator` o un puerto.
4. **[auto]** SQL solo en `*/infrastructure/sqlite-*.ts` y `platform/sqlite`.
5. **[auto]** `new` de adaptadores solo en `bootstrap/` (y en las pruebas).
6. **[auto]** `shared/contracts` importa solo `shared/kernel`; `desktop` importa solo `shared/*`.

**Tamaño y forma**

7. **[auto]** Archivo `.ts` ≤ 300 líneas y `.tsx` ≤ 250. Función ≤ 60 líneas. Si no cabe, se parte **antes** de añadir.
8. Un caso de uso por archivo, con nombre verbo-sustantivo (`accept-execution.ts`) y un único método público `execute`. Prohibidos los `*Service`/`*Manager` que agrupan acciones.
9. Constructor ≤ 6 dependencias; puerto ≤ 8 métodos. Más es señal de que el caso de uso o el puerto hacen dos cosas.
10. **[auto]** Prompts y textos de más de 3 líneas en `prompts/*.md`, cargados por `platform/prompts.ts` y copiados en `build:core` (como las migraciones).
11. Los handlers IPC solo parsean argumentos, llaman a un caso de uso y devuelven un DTO; sin reglas de negocio.

**Interfaz (MVVM)**

12. **[auto]** `window.workspaceIpc` solo en `desktop/core/ipc` y en `*.api.ts`.
13. Una View no tiene `useEffect` ni llamadas IPC: todo viene de su ViewModel (`use-*.vm.ts`). La lógica sin React va en `*.logic.ts` con pruebas unitarias.
14. Estado que sobrevive a cambiar de vista (grafo, selección, borradores) en el store de `desktop/core`; el filtrado de una vista nunca modifica el store compartido.
15. Textos de la interfaz en español en `ui/i18n/es.ts`; identificadores y comentarios del código en inglés (convención actual).

**Pruebas y documentación**

16. Las pruebas reflejan los módulos (`tests/<módulo>/…`): unitarias para dominio y casos de uso con puertos falsos, integración para adaptadores, UI para ViewModels y Views.
17. Cada cambio de límites de un módulo actualiza `docs/ARQUITECTURA.md` en el mismo commit. Un único documento de arquitectura vigente; los antiguos pasan a `docs/historico/`.
18. Las reglas se copian a un `CLAUDE.md` en la raíz para que los agentes (incluido el propio piloto cuando trabaje en este repositorio) las sigan.

**Cómo se aplican sin parar el trabajo:** `check:arch` arranca con una **línea base** (los 21 archivos que hoy superan el límite y las importaciones que hoy rompen las reglas). Lo nuevo debe cumplir; lo que está en la línea base no puede crecer, y cada fase la va vaciando. Cuando esté vacía, se borra.

## 6. Plan de migración

Sin cambiar comportamiento ni el protocolo IPC (canales y argumentos iguales): la interfaz y el host Rust no notan la diferencia. Cada fase termina con `npm run typecheck`, las 494 pruebas (o más) en verde, una ejecución real con `haiku` sobre `todo-app` y un commit.

| Fase | Contenido | Tamaño | Cómo se comprueba |
| :--- | :--- | :--- | :--- |
| **A0 · Guardarraíles** | `CLAUDE.md` con las reglas, `scripts/check-architecture.mjs` con línea base, script en `package.json` y CI. Entrada estable `src/sidecar.ts` y rutas de Rust, `tsconfig.core.json` y benchmarks apuntando a ella. | S (½ día) | `check:arch` pasa con la línea base y falla con una importación prohibida de prueba. `npm run desktop` arranca. |
| **A1 · Composición e IPC** | `bootstrap/container.ts` + `ipc-router.ts`; el `switch` de 65 canales pasa a `ipc.ts` por módulo; reglas y SQL de `workspace-core.ts` a casos de uso y repositorios. `shared/kernel` y dominio sin importar DTO. | M (1 día) | `workspace-core.ts` desaparece; `tauri-sidecar-core.test.ts` intacto y en verde. |
| **A2 · Mover a módulos** | Traslado mecánico con `git mv` (un módulo por commit, conserva el historial) a `modules/` y `platform/`; pruebas a `tests/<módulo>/`. | M (1 día) | Solo cambian rutas de import; diff sin cambios de lógica. |
| **A3 · Partir los gigantes del núcleo** | `AgentOrchestrator`, `SqliteAgentExecutionRepository` y sus puertos, `FeaturePilot`, `ProjectInceptionService`; prompts a `.md`; `Clock`/`IdGenerator`. | L (2–3 días) | Ningún archivo del núcleo en la línea base; pruebas de los casos de uso con puertos pequeños. |
| **A4 · Interfaz MVVM** | `desktop/core` (IPC y store), carpetas por feature, View + ViewModel de las cinco pantallas grandes. Se aprovecha para cerrar B1 y B4 de la auditoría UX, que son consecuencia directa de la falta de ViewModels. | L (2–3 días) | Pruebas de UI en verde; nuevas pruebas de ViewModel para filtro y borradores; recorrido con el arnés de la auditoría. |
| **A5 · Documentación** | `ARQUITECTURA_ACTUAL.md` → `ARQUITECTURA.md`; históricos a `docs/historico/`; rutas actualizadas (§7); línea base vacía y eliminada. | S | Ningún enlace roto (`grep` de rutas `src/` en `docs/`). |

**Estado de A0 (2026-11-12): hecho.** `CLAUDE.md` en la raíz; `scripts/check-architecture.mjs` (usa el compilador de TypeScript, sin dependencias nuevas) con la línea base `scripts/architecture-baseline.json` (120 entradas al crearla), dentro de `npm test` (`tests/unit/architecture.test.ts`), como `npm run check:arch` y en CI; entrada estable `src/sidecar.ts` → `dist/main/sidecar.js` (y `core/sidecar.js` en el paquete), con `src-tauri/src/lib.rs` y `tsconfig.core.json` al día. Los benchmarks siguen importando `workspace-core.js` y `database.js` por su ruta: se actualizan en A1–A2, cuando esos archivos se muevan.

**Estado de A1 + A2 (2026-11-12): hecho.** 111 archivos movidos con `git mv` a 10 módulos, `src/platform/` y `src/bootstrap/`; cada módulo con `index.ts` (generado con lo que usan los demás) y `ipc.ts`. `workspace-core.ts` pasó de 1 258 líneas a 50: `container.ts` + `compose/*.ts` crean los adaptadores y `ipc-router.ts` une los canales (uno repetido falla al arrancar). El SQL que había en la composición pasó a `environment/infrastructure/sqlite-project-environment.ts` y `execution/infrastructure/sqlite-review-evidence.ts`. Benchmarks, `tsconfig.core.json`, la copia de migraciones y los alias de pruebas están al día. Quedaron para A1b `shared/kernel` y la serialización declarada por handler.

**Estado de A3 (2026-11-12): en curso.**

- **A3a, el orquestador (hecho):** `agent-orchestrator.ts` pasó de 1536 a unas 170 líneas.
  - Queda como fachada con la misma API para la IPC, el piloto y la composición.
  - Cada acción vive en su archivo y recibe el `ExecutionKernel`, que reúne los puertos y el estado de las ejecuciones en curso.
  - Las funciones de más de 60 líneas se partieron en pasos con nombre: `start` en `planStart`, `prepareRun`, `launchRun` y `failStart`; `consume` en `followStream`, `validateRun` y `failConsumer`; `accept` en `acceptable`, `recordConflict` y `dropWorktree`.
  - El prompt de la tarea pasó a `application/prompts/task-prompt.ts`.
  - El orquestador ya no importa `node:crypto` (usa `globalThis.crypto`) y salió de la línea base.
  - Comportamiento idéntico: pasan las 587 pruebas sin tocarlas. Las corridas reales con `haiku` de 3d (dos tareas, documentos, integración, 16 pruebas en `main`) y de C6 (instalación de Next.js, `next build`, integración) dan el mismo resultado que antes.
- **A3b, el repositorio de ejecuciones (hecho):** `SqliteAgentExecutionRepository` pasó de 909 a 133 líneas.
  - Queda como fachada que delega en siete repositorios `sqlite-execution-*.ts`: perfiles, política, aprobaciones, tareas, ramas, resultados y ejecuciones. Las filas y su mapeo van en `sqlite-execution-rows.ts`.
  - El puerto `AgentExecutionRepositoryPort` ahora extiende ocho puertos de como mucho ocho métodos, en `ports/execution-store-port.ts` (regla 9). Los casos de uso pueden depender solo del que usan.
  - `recordTaskOutcome` se partió en `linkFiles` y `upsertCodeReference`, y `node:crypto` dejó paso a `globalThis.crypto`.
  - Pasan las 587 pruebas sin tocarlas. La corrida real con `haiku` de 3d da el mismo resultado.
- **A3c, el piloto (hecho):** `FeaturePilot` pasó de 691 a unas 70 líneas.
  - Queda como fachada sobre el `PilotKernel`, repartido en `pilot-control` (autonomía, iniciar, detener, reanudar, pausar), `pilot-loop`, `pilot-acceptance` (compuertas, revisión y propuesta) y `pilot-kernel` (registro y estado).
  - El bucle es ahora una `pass` por vuelta con pasos con nombre: `settleOpenWork`, `pickNext`, `runTask` y `afterRun`. La aceptación se reparte en `reviewRound`, `revise` y `acceptRun`.
  - Pasan las 587 pruebas sin tocarlas.
  - Corrida real con `haiku`: el piloto lanzó, verificó y aceptó solo dos tareas encadenadas en 24 s, y quedan 11 pruebas en verde en la rama de la feature.
- **Pendiente:** A3d, el inicio; A3e, el resto.

**Estado de A1b (2026-11-12): hecho.** `src/shared/kernel/` (`graph.ts`, `artifacts.ts`) tiene el vocabulario común; el dominio ya no importa `shared/contracts` y los contratos lo reexportan. El informe de métricas pasó a `shared/contracts/metrics-view.ts` (los contratos ya no importan módulos). Cada `ipc.ts` marca con `serial(...)` los canales que mutan estado; el router expone `isSerialized` y el despachador ya no tiene lista propia. Pruebas nuevas: los canales serializados son exactamente los de antes y todo canal que llama el cliente de Tauri tiene handler. En la línea base de capas solo quedan los tres usos de `node:crypto`/`node:path` en `application/` (Clock/IdGenerator en A3).

La reorganización de pantallas de la auditoría UX (sus fases F1–F3) va **después de A4**: con ViewModels, mover «Piloto» dentro de la feature o unir Ejecutar y Revisión es mover Views, no reescribir lógica.

## 7. Rutas que hay que actualizar al ejecutar el plan

Revisados los últimos commits (`5d0355b`, `5f7b48d` y `a369749`): no hace falta cambiar nada **ahora**, pero estas referencias quedarán obsoletas al mover los archivos.

**Build y arranque (se rompen si no se cambian; fase A0):**

| Dónde | Hoy apunta a |
| :--- | :--- |
| `src-tauri/src/lib.rs:244` y `:249` | `dist/main/infrastructure/ipc/sidecar/main.js` y `core/infrastructure/ipc/sidecar/main.js` → `sidecar.js` |
| `tsconfig.core.json` (`include`) | `src/infrastructure/persistence/**`, `src/infrastructure/ipc/sidecar/**` |
| `scripts-copy-sql.mjs` | `dist/main/infrastructure/persistence/sqlite/migrations` (más los `prompts/` nuevos) |
| `scripts/benchmark/run-benchmark.mjs:77-78,235-237` y `run-todo-benchmark.mjs:45-46,139-141` | `claude-code-adapter.js`, `child-environment.js`, `workspace-core.js`, `database.js` en `dist/main/infrastructure/…` |

**Documentación (fase A5):**

- `docs/AUDITORIA_UX.md` (commit `5f7b48d`): cita `WorkspaceShell.tsx:154`, `PlanningWorkspace.tsx`, `next-step.ts`, `graph-traversal.ts:66`, `decision-status.ts:2`, `AgentsWorkspace.tsx`, `StatusControl`/`DecisionControl` (inspector), `errors.tsx`, `src/desktop/` y, en §7, la ruta del núcleo compilado `dist/main/.../sidecar/main.js` que usa el arnés.
- `docs/ARQUITECTURA_ACTUAL.md` (§1–§5, rutas de carpetas y archivos), `docs/REFERENCIA_IPC.md` (despachador y `SERIALIZED_CHANNELS`), `docs/BASE_DE_DATOS.md` (carpeta de migraciones), `README.md` (mapa de documentación), `src/desktop/theme/MIGRACION.md`.
- Los nombres que usa la memoria del proyecto (`ReferenceTranslatorPort`, `normalizeTranslation`, `hardenPrototype`) se conservan; solo cambia su carpeta.

## 8. Qué no se hace (y por qué)

- **No se cambia el protocolo IPC** ni los nombres de canal: el host Rust y la interfaz siguen igual durante toda la migración. Pasar los argumentos posicionales a objetos con nombre es una mejora aparte, después de A5.
- **No se añaden librerías** (ni gestor de estado, ni inyector de dependencias, ni `dependency-cruiser`): el store se hace con `useSyncExternalStore` y el contenedor es una función. Menos piezas que mantener.
- **No se borra el código de Codex**: se aísla en `platform/codex-cli` y `execution/infrastructure/codex-*` hasta la Etapa 4.
- **No se reescribe la lógica**: cada fase mueve y parte código existente con las pruebas actuales como red. Lo que funciona hoy (motor de contexto, validación del diff, puertas del piloto, `next-step.ts`) se conserva.
