# Objetivo Real de Graph Workspace y Plan de Integración: Visual Exploration & Prototyping

Fecha: 2026-11-11 · Rama: `feat/claude-code` · Estado: Plan aprobado para implementación
Documentos relacionados:
- `docs/PLAN_DE_TRABAJO.md` (Ejecución autónoma, memoria en el grafo y mediciones de las Etapas 1–6)
- `docs/PROPUESTA_ORQUESTADOR_DE_INICIO.md` (Asistente de inicio de proyecto en puertas con `ProjectInceptionService`)
- `docs/ARCHITECTURE.md` y `docs/DOMAIN.md` (Invariantes del grafo, niveles de autoridad y aislamiento Git)
- `docs/benchmarks/2026-11-11-todo-v2-haiku-agrupacion-repeticion.md` (Séptima medición: la agrupación de tareas y sus salvaguardas, base de la Etapa 0)
- `docs/benchmarks/2026-11-11-todo-v2-haiku-piloto-agrupando.md` (Octava medición: el piloto agrupando solo; cierra la Etapa 0)

---

## 1. Cuál es el objetivo real de la aplicación (`Graph Workspace`)

**Graph Workspace no es un chat con un agente ni un generador de prototipos desechables.**
Es un **plano de control de ingeniería local-first** (Tauri 2 + React + Sidecar Node/TypeScript + SQLite + Git) cuyo propósito real es:

> **Permitir que una persona pase de una idea informal (y referencias visuales) a software real, probado y mantenible en un repositorio Git, donde el conocimiento del proyecto vive en un grafo estructurado independiente del motor de IA y los agentes cierran features completas de forma autónoma bajo reglas y puertas de aprobación humanas.**

### 1.1. Las dos mitades que une la aplicación

El mercado actual de herramientas de IA para desarrollo está partido en dos mundos desconectados:
1. **Las herramientas de Día 1 (Prototipado / "Vibe Coding" como Claude Artifacts, Claude Design, v0, Bolt, Lovable):**
   Sirven para explorar visualmente una idea en minutos, pero producen código o diseños aislados sin arquitectura, sin pruebas verificables y sin memoria de decisiones cuando el proyecto crece.
2. **Las herramientas de Día 2 (Agentes de CLI como Claude Code o Codex):**
   Son excelentes editando archivos y corriendo comandos, pero sufren de **amnesia arquitectónica y visual** entre tareas, requieren supervisión constante por chat y te atan al historial de sesión de un solo proveedor.

**Graph Workspace une ambas mitades en una sola línea de trabajo continua:**

```text
╔════════════════════════════════════════════════════════════════════════════╗
║ MITAD A: DESCUBRIMIENTO Y EXPLORACIÓN VISUAL (Día 1 → Conocimiento)        ║
║                                                                            ║
║  1. Idea en lenguaje natural + Referencias (Capturas, Bocetos, Docs)       ║
║     clasificadas como VISUAL (estilo), FUNCIONAL (flujo) o CONCEPTUAL.     ║
║  2. Descubrimiento guiado por puertas (ASK_GOALS): preguntas adaptativas   ║
║     cerradas con opciones recomendadas y detección de ambigüedades.        ║
║  3. Exploración Visual y Prototipado (EXPLORE_UI): generación de 2–3       ║
║     direcciones visuales interactivas (o importación de Claude Artifacts / ║
║     Claude Design) previsualizadas en vivo, iteradas y aprobadas.          ║
║  4. Conversión en Conocimiento del Grafo: el diseño y alcance aprobados    ║
║     se compilan en `docs/VISION.md`, `docs/UI_SPEC.md`, `ADR-001` y        ║
║     reglas de Nivel 1 del proyecto.                                        ║
╚═════════════════════════════════════╤══════════════════════════════════════╝
                                      │ ChangeSet fundacional validado
                                      ▼
╔════════════════════════════════════════════════════════════════════════════╗
║ MITAD B: PLANIFICACIÓN Y EJECUCIÓN AUTÓNOMA GOBERNADA (Día 2 → Código)     ║
║                                                                            ║
║  5. Plan en Grafo (DAG): Módulos, Features (empezando por «Fundación»)     ║
║     y Tareas (`WORK_ITEM`) con dependencias explícitas (`DEPENDS_ON`).     ║
║  6. Contexto Curado por Autoridad (`ContextSnapshot` sellado desde Git):   ║
║     • Nivel 1: Perfil del proyecto, reglas y convenciones aprendidas.      ║
║     • Nivel 2: Decisiones de arquitectura aceptadas (`DECISION_RECORD`).   ║
║     • Nivel 3: Especificaciones (`UI_SPEC.md`, `SPEC`) y requisitos.       ║
║     • Nivel 4: Referencias a archivos de código modificados (`MODIFIES`).  ║
║     • Nivel 5: Resúmenes de cierre (`TaskOutcome`) de tareas previas.      ║
║  7. Piloto Automático (`FeaturePilot`) + Validador (`ExecutionValidator`): ║
║     Cada tarea corre en su propio `git worktree`, pasa auditoría de rutas  ║
║     y comandos de verificación obligatorios, hace squash merge en la rama  ║
║     `feature/<slug>`, promueve nuevas convenciones a Nivel 1 y al cerrar   ║
║     la feature se integra de forma segura en `main`.                       ║
╚════════════════════════════════════════════════════════════════════════════╝
```

### 1.2. Propuesta de valor demostrada y defendible

De acuerdo con las 7 mediciones en `docs/benchmarks/`:
- **Cero orquestación humana repetitiva (H4):** El piloto automático cierra features multi-tarea con la misma calidad que el mejor chat supervisado a mano, reduciendo las intervenciones humanas de $N$ a $0$ salvo cuando hay una decisión real de arquitectura o alcance (`decision-policy.ts`).
- **Memoria que no se degrada entre tareas ni entre features (H2):** Las convenciones declaradas al cerrar una tarea y las especificaciones (`UI_SPEC.md`, ADRs) viajan siempre en los niveles superiores de autoridad del `ContextSnapshot`.
- **Costo por debajo del chat largo, agrupando tareas pequeñas (H1, medido pero no integrado):** Una ejecución por tarea cuesta ~1,5× el chat largo (654 k frente a 414 k ponderados en la séptima medición). Agrupar 2–3 tareas pequeñas de la misma feature en una ejecución baja el costo a 377 k (−42 %, por debajo del chat) con igual o mejor calidad (32,5/33 frente a 31/33), repetido en tres corridas. **Hoy la agrupación solo existe en el escenario de medición (`scripts/benchmark/todo-v2-agrupado`, agrupado a mano); el piloto de la app sigue lanzando una ejecución por tarea.** Llevarla al producto es la Etapa 0 de este plan.
- **Portabilidad entre motores (H3, diseñada, pendiente de demostrar):** Ni el descubrimiento (`project_inception`) ni la ejecución (`task_outcomes`, `context_snapshots`) dependen de la sesión interna del CLI, así que una etapa o tarea puede ejecutarla Claude Code y la siguiente Codex sin reconstruir contexto a mano. Los adaptadores de Codex siguen sin cablear (Etapa 4 de `docs/PLAN_DE_TRABAJO.md`); H3 no se ha medido.

---

## 2. Qué se quiere desarrollar: Visual Exploration, Reference Analysis & `UI Specification`

### 2.1. Problema que resuelve dentro de Graph Workspace

En proyectos de lógica pura o CLI (como `todo-app`), los criterios de aceptación textuales y las pruebas unitarias bastan para que el piloto automático construya el software sin desviarse.
Sin embargo, **cuando el proyecto tiene interfaz de usuario**:
1. El usuario muchas veces sabe qué quiere lograr viendo referencias o probando un prototipo, pero no sabe redactar de entrada una especificación de pantallas, estados y componentes.
2. Las pruebas automatizadas pasan aunque la interfaz sea incoherente entre la Tarea 1 y la Tarea 4 (distinta navegación, distintos patrones visuales, estados de error o vacío olvidados).
3. Si el agente `DEVELOPER` no recibe un contrato visual explícito en su `ContextSnapshot`, inventa decisiones de UI distintas en cada ejecución.

### 2.2. Las tres capacidades a incorporar en el Inicio y la Planificación

#### Capacidad 1: Descubrimiento Conversacional por Puertas (`Conversational Discovery`)
- Comprender problema, propósito, usuarios objetivo, alcance y qué queda fuera mediante preguntas adaptativas generadas según el `brief` y las referencias previas.
- Explicar alternativas en lenguaje claro, detectar contradicciones y separar **requisitos confirmados** de **suposiciones (`assumptions`)**.
- Mantener el diseño de **puertas estructuradas** de `ProjectInceptionService` (evitando un chat libre infinito sin criterio de cierre) y permitir iterar mediante notas de cambio (`notes`) o ajuste de respuestas.

#### Capacidad 2: Análisis de Referencias y Materiales (`Reference & Asset Analysis`)
- Permitir adjuntar capturas de pantalla, diseños, wireframes, bocetos, prototipos HTML o documentos.
- Clasificar obligatoriamente cada referencia en una de tres categorías para que el motor no confunda estética con alcance funcional:

| Tipo de referencia | Qué indica al motor | Regla de interpretación |
| :--- | :--- | :--- |
| **`VISUAL`** | Cómo debería verse la aplicación (paleta, densidad, estilo, tipografía, layout). | No asumir que las funciones que aparecen en la imagen son requisitos del proyecto. |
| **`FUNCIONAL`** | Qué comportamiento, flujo o interacción concreta se desea conseguir. | Extraer pantallas, acciones e interacciones observables; preguntar lo que sea ambiguo. |
| **`CONCEPTUAL`** | Qué experiencia general o problema se busca resolver (inspiración). | Tomar solo la idea rectora sin copiar literalmente ni la interfaz ni todas sus funciones. |

#### Capacidad 3: Exploración Visual, Prototipado y Destilación a `UI Specification`
- **Generación e importación agnóstica del proveedor:**
  - El motor conectado puede proponer **2 a 3 direcciones visuales contrastantes** con prototipos HTML interactivos autocontenidos.
  - O bien el usuario puede **importar** prototipos/diseños generados externamente en **Claude Artifacts** o **Claude Design** (archivos HTML/React/imágenes).
- **Iteración y aprobación:**
  - El usuario prueba los prototipos dentro de un visor seguro en la app (`<iframe sandbox="allow-scripts">`), pide ajustes con notas o aprueba la dirección elegida.
  - **Separación de responsabilidades:** aprobar la dirección visual fija la experiencia de usuario, pero la arquitectura y el plan de tareas se aprueban en la puerta de propuesta (`PROPOSAL`).
- **Conversión del diseño en conocimiento estructurado (`docs/UI_SPEC.md`):**
  - El diseño aprobado nunca queda como un archivo suelto; se compila en un artefacto Markdown versionado (`docs/UI_SPEC.md`, tipo `SPEC`, Nivel 3 de autoridad) vinculado por aristas `DOCUMENTED_BY` a las features del grafo, con 8 apartados obligatorios:
    1. **Screens:** Inventario de pantallas y su propósito.
    2. **Navigation:** Estructura de navegación y paso entre pantallas.
    3. **Components:** Componentes visuales reutilizables y su jerarquía.
    4. **Interactions:** Acciones del usuario y comportamientos esperados.
    5. **UI States:** Estados vacíos (`empty`), de carga (`loading`), de error (`error`) y de éxito (`success`).
    6. **User Flows:** Recorridos principales de principio a fin.
    7. **Design System:** Tokens de color, tipografía, espaciado y patrones visuales.
    8. **Design Decisions:** Decisiones visuales y funcionales aprobadas y qué quedó descartado.

---

## 3. Reglas de arquitectura para aplicarlo en `graphdev2` (Enfoque 80/20)

Para mantener el núcleo limpio y coherente con `docs/ARCHITECTURE.md`:

1. **Reutilizar las primitivas actuales del grafo (cero tablas paralelas innecesarias):**
   - No se crean tablas separadas para `Design Session`, `Design Artifact`, `Design Review` ni `Design Specification`.
   - El estado de exploración durante el arranque vive en la tabla existente `project_inception` (`008_project_inception.sql` + `009` + nueva migración `010`).
   - Al aprobarse, los entregables son entidades nativas del grafo:
     - `docs/UI_SPEC.md` → nodo `ARTIFACT` (`artifactType: 'SPEC'`) + aristas `DOCUMENTED_BY` hacia cada `FEATURE`.
     - `docs/design/prototype.html` → nodo `ARTIFACT` (`artifactType: 'SPEC'`) versionado en Git para consulta en cada worktree.
     - Reglas del sistema de diseño → entradas en `SET_PROJECT_PROFILE.rules` (Nivel 1 de autoridad).
     - Decisiones clave → `DECISION_RECORD` (`ADR`, Nivel 2 de autoridad).
2. **Inyección automática en los agentes sin acoplamiento:**
   - Como `GraphTraversal.expand` (`src/application/context/graph-traversal.ts`) ya incluye en **Nivel 3 (obligatorio)** todo `ARTIFACT` de tipo `SPEC` unido por `DOCUMENTED_BY` a la feature o tarea activa, cualquier agente `DEVELOPER` lanzado manualmente o por `FeaturePilot` recibirá automáticamente `docs/UI_SPEC.md` en su `ContextSnapshot`.
3. **Paso visual opcional según el tipo de proyecto:**
   - Los proyectos sin interfaz gráfica (librerías, CLIs, servicios backend) o los usuarios que prefieran ir directo al plan pueden saltar de `ASK_GOALS` a `PROPOSAL` sin fricción.

---

## 4. Plan de aplicación paso a paso

### Etapa 0: Agrupación de tareas pequeñas en el piloto (Tamaño: M–L — 1,5 a 2 días)

Va antes que la Mitad A porque afecta a **todo** usuario del piloto hoy, mientras que la exploración visual solo afecta a proyectos nuevos con interfaz. Recoge las cinco salvaguardas de la séptima medición. Hasta que esta etapa se cierre y se mida en el piloto real, el README y la guía deben decir que la cifra de −42 % es de medición, no del producto.

**Qué cambia para el usuario.** En el panel del piloto de una feature aparece la opción «Agrupar tareas pequeñas» (se planeó desactivada por defecto; tras la octava medición quedó activa por defecto en features nuevas). Con ella activa, el piloto junta 2–3 tareas listas de la misma feature en una sola ejecución; el aviso de costo pasa de «quedan N tareas» a «quedan N tareas en ~M ejecuciones». Cada tarea sigue teniendo su propio estado, su resumen de cierre y su trazabilidad en el grafo: la agrupación es un detalle de ejecución, no del plan.

**Decisiones de diseño (tomadas aquí, no se vuelven a discutir):**

1. **El plan no se toca.** No se fusionan WorkItems. Un grupo es una ejecución que cubre varios WorkItems; si el usuario desactiva la opción, el piloto vuelve a una tarea por ejecución sin migrar nada.
2. **Una ejecución, una tarea «líder» y varias «cubiertas».** `agent_executions.work_item_id` sigue siendo la tarea líder (la primera del grupo), para no romper nada de lo que hoy consulta por ese campo. Las demás van en una tabla nueva `execution_work_items(execution_id, work_item_id, position)` (migración `010_execution_groups.sql`; la migración de la Mitad A pasa a ser `011`).
3. **Todo el grupo se mueve junto.** Al iniciar, todas pasan `READY → IN_PROGRESS`; al completar, `→ IN_REVIEW`; al aceptar, `→ DONE` y se desbloquean los dependientes de cada una (`unblockDependents` por tarea); si falla, todas vuelven a `READY` y **el reintento es del grupo entero** con el error como contexto. Un commit por grupo en la rama de la feature: `TASK-004, TASK-005: <título del grupo>` con un trailer `Task: TASK-004 <título>` por tarea.
4. **Un resumen de cierre por tarea.** El prompt exige el resumen final con un apartado por WorkItem (Hecho / Decisiones / Convenciones / Pendiente para cada uno). Al aceptar se guarda un `TaskOutcome` por tarea a partir de su apartado; si el agente no separó los apartados, se guarda el resumen completo en cada tarea con una nota, y se registra como incidencia en el log del piloto (sirve para medir cuántas veces pasa). Las convenciones se promueven a nivel 1 una sola vez (sin duplicados).
5. **Qué puede agruparse** (función pura `planTaskGroups`, en `src/application/execution/task-grouping.ts`, probada en unitario):
   - misma feature, todas `READY` o `BLOCKED` solo por tareas del mismo grupo (así A1+A2 con `DEPENDS_ON` entre ellas pueden ir juntas, como en el escenario medido);
   - tamaño máximo 3 tareas (configurable en la feature, 1–5) y suma de criterios de aceptación ≤ 2 × tamaño (6 para grupos de 3; ajustado tras la octava medición: un tope fijo dejaba solas a tareas medianas);
   - **la tarea que fija una convención va sola**: la primera tarea del proyecto (ninguna tarea `DONE` antes), y toda tarea cuyo título o resumen declare una («a partir de esta tarea», «convención del proyecto», «fija/establece/define la convención»); mencionarla («según la convención») no cuenta (ajustado tras la octava medición);
   - no se agrupa una tarea con `retryContext` pendiente ni una que ya tenga ejecución activa;
   - el orden del grupo respeta `DEPENDS_ON` y, a igualdad, la clave (`TASK-n`).
6. **Contexto del grupo.** `ContextEngine.preview` recibe la tarea líder como foco y las demás como anclas adicionales (`extraFocusEntityIds`), para que las especificaciones (`DOCUMENTED_BY`) y decisiones (`AFFECTS`) de todas las partes entren en el snapshot con su nivel. Un solo snapshot sellado por ejecución, enlazado desde la ejecución como hoy.
7. **Prompt del grupo** (`buildTaskPrompt` en `agent-orchestrator.ts`): la sección «WorkItem» pasa a «Tareas de este grupo» con «Parte 1 de N», «Parte 2 de N»…, cada una con título, resumen y criterios. Al inicio de cada parte se repite una línea de recordatorio: *los criterios de todas las partes siguen las convenciones del proyecto (incluidos los errores envueltos: `JSON.parse`, `SyntaxError` → la clase de error de la convención)*. Es la salvaguarda 2 del informe y ataca la falla recurrente de TASK-213, que también aparece sin agrupar.
8. **Revisión humana por grupo.** `ExecutionReview` muestra las tareas cubiertas; «Pedir ajustes» vuelve a lanzar el grupo entero; la bandeja y el log del piloto nombran todas las claves (`TASK-004, TASK-005`).

**Entregas:**

| # | Entrega | Archivos | Pruebas |
| :--- | :--- | :--- | :--- |
| 0.1 | Migración `010_execution_groups.sql`, `execution_work_items` en `SqliteWorkspaceRepository`, `coveredWorkItemIds` en `AgentExecution` y en `ExecutionDto` | `migrations/`, `database.ts` (`USER_VERSION = 10`), `sqlite-workspace-repository.ts`, `shared/contracts` | `migrations.test.ts`, `sqlite-persistence.test.ts` |
| 0.2 | `planTaskGroups` con las reglas de la decisión 5 | `application/execution/task-grouping.ts` | `tests/unit/task-grouping.test.ts` (convención sola, tope de 3 y de 6 criterios, dependencias internas, orden) |
| 0.3 | `AgentOrchestrator.start` acepta `workItemIds[]`: transiciones en bloque, prompt por partes, contexto con anclas extra, commit con trailers, `TaskOutcome` por tarea, `unblockDependents` por tarea, reintento y «pedir ajustes» del grupo | `agent-orchestrator.ts`, `context-engine.ts`, `context-resolver.ts` | `work-item-lifecycle.test.ts`, `review-flow.test.ts`, `task-memory.test.ts` (un outcome por tarea; resumen sin separar) |
| 0.4 | `FeatureAutonomy.groupTasks` (+ `maxGroupSize`), columna en `feature_autonomy`, el piloto usa `planTaskGroups` cuando está activa y registra `GROUP_STARTED` con las claves | `domain/autonomy/models.ts`, `feature-pilot.ts`, migración `010` | `feature-pilot.test.ts` (grupo aceptado; grupo que falla vuelve a READY y se reintenta entero; tarea de convención sola) |
| 0.5 | UI: interruptor «Agrupar tareas pequeñas (experimental)» y tamaño en `FeaturePilotPanel`, aviso de costo con «~M ejecuciones», tareas cubiertas en `ExecutionReview`, claves en `ActivityInbox`; `feature-metrics.ts` atribuye una ejecución agrupada a **todas** sus tareas (hoy solo a la líder, visto en el humo real del 2026-11-11) | `agents/FeaturePilotPanel.tsx`, `agents/ExecutionReview.tsx`, `shell/ActivityInbox.tsx`, `application/execution/feature-metrics.ts` | `feature-pilot-panel.test.tsx`, `review-and-policy.test.tsx`, `feature-pilot.test.ts` (métricas) |
| 0.6 | Benchmark: nuevo brazo `workspace-grouped` en `scripts/benchmark/run-benchmark.mjs` que corre el escenario **sin agrupar** (`todo-v2`) con el piloto agrupando solo, en lugar del escenario pre-agrupado | `scripts/benchmark/` | Corrida real con `haiku` (ver criterios) |

**Estado (2026-11-11): Etapa 0 hecha** (`d728673`, `5c37886`, `71edf5e` y el commit de la octava medición). Medida con el piloto agrupando solo sobre `todo-v2` (`docs/benchmarks/2026-11-11-todo-v2-haiku-piloto-agrupando.md`): con grupos de 3, **33/33 pruebas ocultas y 9/9 de la convención en tres corridas, 8–9 ejecuciones en vez de 13 y −17 % a −20 % de costo ponderado** (la base sacó 28/33); con grupos de 4, −26 % pero la convención cae a 3/9. El criterio 2 (−30 %) **no se alcanza**: el 30 % venía del escenario agrupado a mano, que no respeta las salvaguardas. **Decisión del usuario (2026-11-11, delegada en el criterio del asistente): activa por defecto con tamaño 3** en features nuevas (las que ya tenían autonomía guardada conservan su valor), porque iguala la calidad, no añade intervenciones y cuesta menos; tamaño 4 o más, solo con medición propia.

**Criterios de aceptación de la Etapa 0:**

1. Con la opción desactivada, ninguna prueba existente cambia de resultado y el piloto se comporta exactamente como hoy.
2. Con la opción activa sobre `todo-v2` y el piloto real (brazo `workspace-grouped`, ×2): costo ponderado al menos un 30 % por debajo del brazo `workspace` de la misma corrida, pruebas ocultas y convención respetada por tarea **no peores** que sin agrupar, cero intervenciones. Si la deriva de convención del agrupado supera a la del modo normal, la opción se queda desactivada por defecto y se documenta. **Resultado (octava medición):** calidad y convención no peores (mejores, de hecho) y cero intervenciones; costo −19 % (no −30 %). Se activó por defecto igualmente (tamaño 3) por decisión del usuario: la calidad pesa más que el umbral de costo; documentado.
3. En el workspace resultante: cada tarea del grupo está en `DONE`, tiene su propio `TaskOutcome` y sus `CODE_REFERENCE` con `MODIFIES`; el commit del grupo lleva un trailer por tarea; la siguiente tarea de la feature recibe en su contexto el resumen de **cada** tarea de la que depende, no uno solo.
4. README, `GUIA_DE_USO.md` y `PLAN_DE_TRABAJO.md` dejan de decir «repetición en curso» y describen la opción, su valor por defecto y la cifra medida en el piloto real. **Hecho.**

**Fuera de la Etapa 0:** agrupar desde la vista Agentes en modo manual (selección múltiple de tareas `READY`) y agrupar tareas de distintas features; se deciden tras medir. (Activarla por defecto estaba fuera; se decidió tras la octava medición.)

---

### Etapa V0: Ajustes base y optimización de contexto previos (Tamaño: S — 2 a 3 horas)

**Estado (2026-11-11): hecha.** (1) El texto de contexto ya no repite reglas y convenciones (solo aparecen en `<Constraints>`; sus fuentes de nivel 1 siguen en el snapshot guardado) y cada `<Source>` se nombra por su clave legible, sin hash: −16 % de caracteres en un proyecto pequeño (unos 370 tokens por ejecución con 4 reglas; el ahorro crece con las reglas, así que la estimación de ~20 % del plan era optimista para proyectos chicos). (2) `operationLabel` cubre `UPDATE_ENTITY_STATUS`, `SET_PROJECT_PROFILE` y `DELETE_RELATIONSHIP`, con una prueba que fija los diez textos. (3) El planificador de ChangeSets recibe los flags de aislamiento del CLI, con una aserción en su prueba. (4) La autenticación del motor tiene su propia consulta (`provider:get_auth`) y el formulario funciona en un proyecto sin features; los clientes antiguos caen al estado del piloto de la primera feature. Humo real con haiku (copia de `todo-app`, TASK-201 sola y 202+204 agrupadas): 9/9 pruebas ocultas.
Antes de expandir el asistente de inicio, cerrar los 4 ajustes técnicos detectados en la auditoría del código actual:

1. **Eliminar duplicación de convenciones y ruido en el prompt de contexto:**
   - En `src/application/context/context-resolver.ts` y `src/application/context/context-packager.ts`: no enviar las reglas y convenciones dos veces (en `<Constraints>` y además como `<Source id="policy:...">` / `<Source id="convention:...">`), y omitir `hash` SHA-256 e IDs UUID en las etiquetas `<Source>` enviadas al modelo (usando `entityKey` legible), conservándolos íntegros en SQLite. Esto ahorra ~20 % de tokens en cada ejecución.
2. **Completar etiquetas de operaciones en UI:**
   - En `src/desktop/presentation/labels.ts`: mapear `UPDATE_ENTITY_STATUS`, `SET_PROJECT_PROFILE` y `DELETE_RELATIONSHIP` en `operationLabel`.
3. **Aislamiento de flags CLI en el planificador:**
   - En `src/infrastructure/ai/claude-change-set-planner.ts`: pasar `CLAUDE_ISOLATION_ARGS` en `propose()`.
4. **Autenticación del motor en proyectos vacíos:**
   - En `src/desktop/presentation/agents/EngineAuthForm.tsx` y `workspace-core.ts`: permitir consultar y cambiar `authMode` (`subscription` / `api_key`) aunque el proyecto aún no tenga ninguna `FEATURE`, para que aplique desde el Asistente de Inicio.

---

### Etapa V1: Referencias (`VISUAL` / `FUNCIONAL` / `CONCEPTUAL`) en el Inicio (Tamaño: S–M — ~0.5 días)

1. **Migración `011_inception_visual_exploration.sql`** (la `010` es la de la Etapa 0):
   ```sql
   ALTER TABLE project_inception ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE project_inception ADD COLUMN ui_options_json TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE project_inception ADD COLUMN selected_ui_option_id TEXT DEFAULT NULL;
   ```
   Actualizar `src/infrastructure/persistence/sqlite/database.ts` (`USER_VERSION = 11`) y `SqliteInceptionRepository`.
2. **Contratos (`src/shared/contracts/inception-view.ts` y `ipc-contracts.ts`):**
   - Definir `InceptionReferenceDto`:
     ```ts
     export type ReferenceKind = 'VISUAL' | 'FUNCTIONAL' | 'CONCEPTUAL';
     export interface InceptionReferenceDto {
       id: string;
       name: string;
       relativePath: string;
       kind: ReferenceKind;
       note: string;
     }
     ```
   - Permitir enviar `references?: InceptionReferenceDto[]` en `StartInceptionInput` o añadirlas antes de iniciar.
3. **Prompts (`src/infrastructure/ai/inception-contract.ts`):**
   - Incluir el bloque estructurado de referencias en `buildQuestionsPrompt` y `buildProposalPrompt`, instruyendo al modelo a respetar la distinción entre referencia `VISUAL`, `FUNCTIONAL` y `CONCEPTUAL` y a preguntar cualquier comportamiento no confirmado.
4. **UI (`src/desktop/presentation/inception/InceptionAssistant.tsx`):**
   - Añadir en `StartStep` la sección opcional para registrar referencias (ruta de imagen/captura/documento o nota de producto similar + selector `Visual / Funcional / Conceptual` + qué conservar o modificar).

---

### Etapa V2: Etapa `EXPLORE_UI` y Prototipado Interactivo / Importación (Tamaño: M — ~1 día)

1. **Contrato de exploración visual (`src/shared/contracts/inception-view.ts` y `src/application/ports/inception-port.ts`):**
   - Añadir `'EXPLORE_UI'` a `InceptionStage` y `'CHOOSE_UI' | 'RETRY_UI'` a `InceptionNextAction`.
   - Definir `InceptionUiOptionDto`:
     ```ts
     export interface InceptionUiOptionDto {
       id: string;
       title: string;
       summary: string;
       navigation: string;
       screens: string[];
       designSystemNotes: string[];
       prototypeHtml: string;
       source: 'GENERATED' | 'IMPORTED';
     }
     ```
   - Añadir `exploreUi(...)` a `InceptionEnginePort` y `ClaudeInceptionEngine` con un esquema JSON (`uiExplorationSchema`) que pida 2–3 alternativas de interfaz con un prototipo HTML autocontenido cada una.
2. **Servicio (`src/application/inception/project-inception-service.ts`):**
   - En `answer()`: permitir elegir si tras responder las preguntas se pasa a `EXPLORE_UI` (proyectos con interfaz) o directo a `PROPOSAL` (proyectos sin interfaz o cuando el usuario decide saltar la exploración visual).
   - Añadir `importPrototype(projectId, input)`: permite incorporar un prototipo HTML externo (por ejemplo, exportado de **Claude Artifacts** o **Claude Design**) como una opción seleccionable e iterable.
   - Añadir `selectUiOption(projectId, optionId, notes?)`: si incluye `notes`, regenera/ajusta el prototipo; si confirma la opción, guarda `selectedUiOptionId` y lanza `engine.propose(...)` con la dirección visual aprobada.
3. **UI (`src/desktop/presentation/inception/VisualExplorationStep.tsx`):**
   - Tarjetas para alternar entre las 2–3 direcciones visuales propuestas.
   - Visor en vivo aislado: `<iframe title="Vista previa del prototipo" sandbox="allow-scripts" srcDoc={selectedOption.prototypeHtml} />`.
   - Formulario plegable *"Importar prototipo externo (HTML / Claude Artifact)"*.
   - Botones de acción claros:
     - Primario: **«Aprobar esta dirección visual y preparar el plan»**.
     - Secundario: **«Pedir ajustes a este prototipo»** (usando el flujo de notas).
     - Secundario: **«Saltar diseño e ir directo al plan»**.

---

### Etapa V3: Destilación a `docs/UI_SPEC.md` y Conexión con el Grafo (Tamaño: S–M — ~0.5 días)

1. **Generación de `UI_SPEC.md` en el ChangeSet (`src/infrastructure/ai/inception-contract.ts`):**
   - Cuando `buildProposalPrompt` recibe una `selectedUiOption` aprobada:
     - Exigir un `UPSERT_ARTIFACT` con `tempId: '$ui_spec'`, `artifactType: 'SPEC'` y `relativePath: 'docs/UI_SPEC.md'` que contenga las 8 secciones de la especificación de interfaz (*Pantallas*, *Navegación*, *Componentes*, *Interacciones*, *Estados de UI*, *Flujos de usuario*, *Sistema de diseño* y *Decisiones visuales*).
     - Exigir que `SET_PROJECT_PROFILE.rules` incluya las convenciones visuales de Nivel 1 (tokens, estados obligatorios de carga/vacío/error, estructura de componentes).
2. **Garantías deterministas en `src/application/inception/foundation-plan.ts`:**
   - Cuando el inicio cuenta con una opción visual aprobada (`selectedUiOption`):
     - Si la propuesta del motor no incluyó `docs/UI_SPEC.md`, reportarlo en `problems` para revisión/regeneración.
     - Inyectar automáticamente un `UPSERT_ARTIFACT` para `docs/design/prototype.html` con el HTML del prototipo aprobado (para que quede commiteado en el repositorio y accesible en cada worktree).
     - Añadir automáticamente relaciones `CREATE_RELATIONSHIP` (`edgeType: 'DOCUMENTED_BY'`) desde cada `CREATE_FEATURE` hacia `$ui_spec`.
3. **Revisión en UI (`src/desktop/presentation/inception/ProposalReview.tsx`):**
   - Mostrar en la revisión de la propuesta la sección **«Interfaz y experiencia acordadas (`docs/UI_SPEC.md`)»** junto con las pantallas, el patrón de navegación y el acceso a la vista previa del prototipo aprobado.

---

### Etapa V4: Evolución continua y Modo Brownfield (Tamaño: M — ~1 a 1.5 días)

1. **Modo Brownfield (`repository:scan` — Etapa E de `PROPUESTA_ORQUESTADOR_DE_INICIO.md`):**
   - Escanear metadatos, manifiestos (`package.json`, `Cargo.toml`, `pyproject.toml`), estructura de carpetas y estilos existentes en repositorios con código previo (respetando `.gitignore`, sin symlinks ni secretos, tope de 48 KB) para que el asistente infiera el stack y el sistema de diseño actual con evidencia.
2. **Actualización visual por Feature en `PlanningWorkspace.tsx`:**
   - Permitir adjuntar referencias o actualizar `docs/UI_SPEC.md` al planificar una nueva feature sobre un proyecto ya en marcha.

---

## 5. Criterios de aceptación y verificación del plan

Orden de ejecución: **Etapa 0 → V0 → V1 → V2 → V3 → V4.** Los criterios de la Etapa 0 están en su propia sección; los siguientes cubren la Mitad A.

1. **Pruebas unitarias y de integración (`vitest`):**
   - `tests/unit/inception-contract.test.ts`: valida que las referencias (`VISUAL`, `FUNCTIONAL`, `CONCEPTUAL`) y la opción de UI seleccionada se serialicen como datos inertes (`inertJson`) y exijan `docs/UI_SPEC.md`.
   - `tests/integration/project-inception.test.ts`:
     - Recorrido **sin UI** (`ASK_GOALS → PROPOSAL → APPLIED`) sigue funcionando en 2 puertas sin regresión.
     - Recorrido **con UI** (`ASK_GOALS → EXPLORE_UI → PROPOSAL → APPLIED`) permite generar o importar un prototipo, iterarlo con notas, aprobarlo y verificar que al aplicar el ChangeSet:
       1. Se escriben y commitean `docs/VISION.md`, `docs/architecture/ADR/ADR-001-stack.md`, `docs/UI_SPEC.md` y `docs/design/prototype.html`.
       2. Todas las features quedan conectadas con `DOCUMENTED_BY` a `docs/UI_SPEC.md`.
       3. Al generar el `ContextSnapshot` de cualquier tarea del plan con `ContextEngine.preview()`, `docs/UI_SPEC.md` aparece incluido en **Nivel 3 de autoridad** y las reglas visuales aparecen en **Nivel 1**.
   - `tests/ui/inception-assistant.test.tsx`: prueba de interfaz del paso `EXPLORE_UI`, selección de alternativa, importación de HTML externo y vista previa en sandbox.
2. **Prueba en real con el piloto automático:**
   - Crear una aplicación con interfaz desde cero usando `Inicio`, aprobar un prototipo en `EXPLORE_UI`, aprobar el plan y correr `FeaturePilot` en dos features consecutivas, comprobando que ambas implementan las pantallas, navegación y estados definidos en `docs/UI_SPEC.md` sin perder coherencia visual entre tareas.

