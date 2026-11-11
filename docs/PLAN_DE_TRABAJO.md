# Plan de trabajo: contexto en el workspace y desarrollo autónomo

Fecha: 2026-11-10 · Rama: `feat/claude-code`
Sustituye como plan vigente a `docs/PLAN_MIGRACION_CLAUDE.md`, que queda como registro de las Fases 0 a 3 y de lo confirmado sobre el CLI de Claude Code.

## 0. Estado de un vistazo

Actualizado: 2026-11-11 (rama `feat/claude-code`). Los commits son los de `git log`; las fechas, las del commit.

| Etapa | Estado | Commits (fecha) |
| :--- | :--- | :--- |
| Preparación: Etapa 7 original, validador endurecido, adaptador de Claude Code, planificador con Claude (D1–D5) | Hecha | `d1f57a5`, `68e0c2d`, `2a90857`, `a1c493b`, `8a4c3d4`, `296c23b`, `41dc81e` (2026-11-10) |
| 1. Cerrar el ciclo (worktree por tarea, rama por feature, aceptar, pedir ajustes, D6) | Hecha (núcleo y UI) | `6d65cb4`, `2dda1c0`, `6298377`, `1aefc8f` (2026-11-10) |
| 2. Memoria que fluye (`TaskOutcome`, evidencia en el grafo, contexto) | Hecha | `31eb39b` (2026-11-10); convenciones como reglas de nivel 1 en `da677b2` |
| 3. Piloto automático (autonomía por feature, reintentos, pausa por uso, robustez) | Hecha, incluidas las decisiones automáticas del agente | `a95ec03`, `6b710c6` (2026-11-10); política de decisiones en `665cae5` (2026-11-11) |
| 5. Demostración y medición (mediciones 1–7) | Hecha con Claude; decisión del usuario tomada (apostar por autonomía y trazabilidad). Agrupación repetida (séptima medición, `a842629`), llevada al piloto como opción (Etapa 0 del plan de exploración visual, `d728673`, `5c37886`, `71edf5e`) y medida con el piloto agrupando solo (octava medición: −19 % con la misma calidad, grupos de 3; activa por defecto en features nuevas por decisión del usuario) | `5ecb8ee`, `5c97bc3`, `da677b2`, `2d3decc` (2026-11-10/11), `2c9c0fc` (2026-11-11) |
| 6. Grafo vivo | Hecha, salvo el camino crítico | `ca96fca` (2026-11-10) |
| Aislamiento entre lanzamientos (contexto leído del commit de partida, CLI sin configuración personal) | Hecha | `15f7831` (2026-11-11) |
| Interfaz renovada (barra lateral, bandeja de actividad, siguiente paso, tema claro/oscuro en todos los paneles) | Hecha | `34aecf0`, `8be2e46` (2026-11-11) |
| Asistente de inicio de proyecto («Inicio») | Hecha (MVP); ver `docs/PROPUESTA_ORQUESTADOR_DE_INICIO.md` | `2618db4`, `d90e76a`, `67e5ec8` (2026-11-11) |
| Ramas con dependencias entre features e «Integrar en main» | Hecha | `f82a470`, `67e5ec8` (2026-11-11) |
| Pruebas de UI deterministas | Hecha | `cd351b5` (2026-11-11) |
| 4. Portabilidad entre motores (Codex) | **Pendiente.** Los adaptadores de Codex siguen en el código sin cablear | — |

**Pendiente, de forma explícita:**

- Etapa 4: reconectar `CodexAgentAdapter` y `CodexChangeSetPlanner` con el contrato actual y medir H3 (necesita cuota de Codex).
- Recortar el prompt de contexto de la tarea (la sexta medición lo identifica como la mayor parte del costo evitable).
- Notificaciones de escritorio fiables: hoy usan la API web `Notification`, sin plugin de Tauri.
- Camino crítico de la feature en el grafo.
- Medir si las instrucciones extra del prompt para proponer cambios al plan alteran el costo ponderado.
- Que el planificador de ChangeSets use el aislamiento de configuración del CLI (hoy solo lo usan las ejecuciones).
- Del asistente de inicio: modo brownfield (`repository:scan`) y el resto de lo que la propuesta deja fuera.


## 1. Visión

Graph Workspace sigue **una línea de trabajo, no una conversación**. El proyecto vive como un grafo (módulos, features, requisitos, tareas, decisiones, documentos y código) dentro del workspace: SQLite más Markdown versionado en el repositorio. Cada tarea se abre con el contexto justo para cerrarla, se cierra con evidencia verificable y deja lo aprendido en el grafo para las tareas que dependen de ella.

Tres consecuencias guían todo el plan:

1. **El contexto vive en el workspace, no en el motor.** Las sesiones del motor son desechables. Nada importante depende del historial de un chat, así que la siguiente tarea puede hacerla Claude Code, Codex u otro motor con el mismo resultado.
2. **El objetivo es cerrar tareas solo.** El usuario deja de ser orquestador: el sistema recorre el plan, ejecuta, verifica, acepta y avanza, y solo pide intervención cuando hace falta una decisión humana.
3. **El grafo se mantiene solo.** Si el usuario tuviera que actualizarlo a mano, se desincronizaría y el proyecto fracasaría. Cada ejecución y cada propuesta actualizan el grafo.

## 2. Lo que hay que demostrar

El proyecto tiene sentido solo si resuelve algo que hoy le duele a trabajar con un agente por chat. Son cuatro hipótesis, cada una con su medida:

| # | Hipótesis | Cómo se mide |
| :--- | :--- | :--- |
| H1 | **Contexto justo.** Una tarea con un `ContextSnapshot` curado se resuelve igual o mejor que en una sesión de chat del mismo motor, con menos tokens y sin arrastrar temas ajenos. La ventaja crece a medida que el proyecto crece. | Criterios de aceptación cumplidos a la primera, reintentos, tokens de entrada y salida, y "deriva": cambios fuera del alcance de la tarea. |
| H2 | **Continuidad sin historial.** Lo aprendido en una tarea cerrada llega a las que dependen de ella mediante el grafo, sin conversación previa. | En tareas dependientes: errores por desconocer el trabajo previo (archivos, nombres o decisiones repetidos o contradichos). |
| H3 | **Portabilidad.** Con el mismo workspace, cambiar de motor en la siguiente tarea no pierde contexto ni calidad. | Una misma feature, mitad con Claude Code y mitad con Codex: mismas métricas que H1 y cero contexto reconstruido a mano. |
| H4 | **Autonomía.** El piloto automático cierra una feature completa con pocas intervenciones. | Tareas cerradas sin intervención / total, intervenciones por motivo y tiempo del usuario dedicado a orquestar. |

**Criterio de corte (fijado de antemano).** Tras la Etapa 5: si H1 no muestra una mejora clara en al menos una de las métricas sin empeorar las demás, o si H4 no reduce de forma clara el tiempo de orquestación frente a usar el motor a mano, se replantea el enfoque antes de seguir construyendo.

## 3. Principios de diseño

- **El workspace es la fuente de verdad.** Prompts, contexto, decisiones y evidencia salen del grafo y del repositorio. No se usa `--resume` para dar continuidad entre tareas; la continuidad es el resumen de cierre guardado en el grafo.
- **Motores intercambiables.** Todo pasa por `AgentAdapterPort` y `ChangeSetPlannerPort`, con un registro de adaptadores por `providerKey`. Ningún dato del dominio depende de un motor concreto.
- **El validador es la autoridad.** Las reglas de permisos del motor son la primera barrera; la auditoría del diff y las pruebas deciden.
- **Las pruebas son la puerta de la autonomía.** Sin comandos de verificación configurados, nada se acepta automáticamente.
- **Presupuesto consciente.** Modelos baratos para ejecutar, capaces para planificar y decidir; pausa automática al acercarse a un límite de uso; una ejecución a la vez.

## 4. Estado actual

> Esta sección describía el punto de partida de la rama (2026-11-10). El estado actual está en la tabla de la sección 0; lo siguiente se conserva como contexto.

Punto de partida, en la rama `feat/claude-code` (detalle en `docs/PLAN_MIGRACION_CLAUDE.md`):

- Etapa 7 (worktrees, auditoría de sandbox, aprobaciones) commiteada.
- Validador endurecido (Git fijado al directorio de administración, symlinks, secretos fuera del parche) y D2, D3.
- Orquestador: D4 (ejecuciones interrumpidas), D5 (cancelación), limpieza de worktrees sin trabajo.
- `ClaudeCodeAdapter` con entorno limpio, comprobación de sesión, permisos desde la política, SIGINT y selección de modelo. Probado con Claude real sobre una copia de `todo-app`.
- La política de ejecución viaja en el prompt.
- `ClaudeChangeSetPlanner` y D1 (IPC concurrente, timeouts por canal, log del sidecar).

Lo que faltaba entonces para que la app aportara algo que el motor solo no aporta: el ciclo no se cerraba, el grafo no aprendía de las ejecuciones, la operación requería tocar la base de datos y no había autonomía. Las Etapas 1 a 3 lo resolvieron.

## 5. Etapas

Tamaños: S = horas, M = ~1 día, L = varios días.

### Etapa 1: Cerrar el ciclo (L)

> **Estado (2026-11-10): hecha a nivel del núcleo y de la UI**, en cuatro entregas (`6d65cb4`, `2dda1c0`, `6298377` y la de D6). Prueba real con Claude `haiku` sobre una copia de `todo-app`, usando solo los canales de la app: propuesta de ChangeSet validada y aplicada, documento commiteado en `main`, el agente leyó la especificación en su worktree, TASK-001 ejecutada, aceptada con squash en `feature/feat-001-crear-y-consultar-tareas` y en `DONE`, y TASK-002 desbloqueada sola. Pendiente: recorrerlo haciendo clic en la ventana de la app.
>
> Ajustes respecto a lo previsto: se permite `DRAFT → BLOCKED` (una tarea planificada que espera a otra) e `IN_PROGRESS → READY` (una ejecución que falla devuelve la tarea). La rama de una feature se pone al día con la rama del usuario (merge) cuando le faltan documentos. Los documentos que escribe la app (ChangeSets y documentos creados o guardados desde la app) se commitean solos; los editados fuera de la app sin commitear bloquean la ejecución con un mensaje claro.

Objetivo: una tarea pasa de `READY` a `DONE` desde la app, con el código en la rama del usuario.

- Estados coordinados: `READY → IN_PROGRESS` al iniciar, `→ IN_REVIEW` al completar, `→ DONE` al aceptar; al pasar a `DONE`, recalcular `BLOCKED`/`READY` de las tareas con `DEPENDS_ON`. `start()` exige que las dependencias estén en `DONE`.
- Commit de los cambios en la rama de la ejecución al validar (hoy `finalCommit` = `initialCommit`). Migración `002`: `base_branch` en `agent_executions` y la rama de integración de cada feature.
- Revisión mínima: canal `execution:get_forensic_detail` y vista con el diff por archivo, `test-output.log` y acciones denegadas.
- Rama por feature: al empezar a ejecutar tareas de una feature se crea `feature/<slug>` desde la rama activa (decisión 4); las ejecuciones parten de esa rama.
- Aceptar: squash hacia la rama de la feature con `TASK-012: título` y el id de ejecución; limpieza de worktree y rama de la ejecución. Conflicto de merge → la tarea queda en `IN_REVIEW` con aviso. La fusión de la feature a la rama principal la hace el usuario.
- Pedir ajustes: nueva ejecución sobre la misma tarea con el motivo del rechazo como contexto.
- Operación sin base de datos: cambiar el estado de una tarea desde el inspector y configurar `allowedCommands` y `writablePaths` del proyecto.
- **D6**: commit automático de los documentos que escribe un ChangeSet, rechazo si esas rutas tenían cambios sin commitear, y bloqueo de `execution:start` mientras algún documento de artefacto no esté en `HEAD`. Junto con la atomicidad del applier (limpieza de `.tmp`/`.bak` y reconciliación al abrir el proyecto).

**Cierre:** en `todo-app`, desde la app y sin tocar SQLite: tarea a `READY`, ejecutar, revisar, aceptar, ver el código en la rama base y la siguiente tarea desbloqueada.

### Etapa 2: Memoria que fluye (M)

> **Estado (2026-11-10): hecha.** Al aceptar una tarea se guarda su resumen de cierre (`task_outcomes`: resumen final del agente con apartados Hecho / Decisiones / Pendiente, archivos del commit integrado y comprobaciones) y la evidencia en el grafo (`CODE_REFERENCE` por archivo con aristas `MODIFIES`, `GENERATED_BY` para documentos, procedencia `EXECUTION`). El contexto de una tarea incluye ese resumen para sus dependencias y para las tareas terminadas de la misma feature, y punteros (nivel 4) a los archivos que tocaron; el inspector muestra el resultado al cerrar; el contexto avisa cuando el bloque obligatorio supera el presupuesto; el prompt del planificador explica las reglas del grafo. **H2 demostrada en real** (Claude `haiku`, copia de `todo-app`): TASK-002 recibió el resumen de TASK-001, editó el módulo existente en lugar de crear otro, respetó sus decisiones y la feature quedó con 12/12 pruebas.
>
> Desviaciones: las referencias de código se pasan como punteros (el agente lee el archivo en su worktree) y no por búsqueda de texto; la lectura de fuentes desde `HEAD` no hizo falta porque D6 exige documentos commiteados antes de ejecutar. El ChangeSet posterior a la ejecución (`AGENT_EXECUTION`) queda para la Etapa 3, donde el piloto lo necesita.

Objetivo: H2. Lo que se aprende al cerrar una tarea llega a las siguientes sin historial.

- **Resumen de cierre** (`TaskOutcome`) al aceptar: qué se hizo (resumen final del agente), archivos tocados, pruebas que pasaron, decisiones tomadas y pendientes detectados. Se guarda en el grafo, ligado a la tarea.
- Evidencia: `CodeReference` por archivo modificado y aristas `MODIFIES` (y `GENERATED_BY` para documentos) con `provenance = 'EXECUTION'`. Esto llena el nivel 4 del Context Engine, hoy siempre vacío.
- El Context Engine incluye los `TaskOutcome` de las dependencias directas y las `CodeReference` relevantes, dentro del presupuesto de tokens, con aviso cuando el bloque obligatorio lo supera.
- Snapshot reproducible: leer las fuentes desde `HEAD` (con D6 resuelto, los documentos siempre están ahí).
- ChangeSet posterior a la ejecución (`originType: 'AGENT_EXECUTION'`) cuando el agente detecta que hay que actualizar documentación o el plan.

**Cierre:** la segunda tarea de una feature recibe en su contexto el resumen y los archivos de la primera, y no repite ni contradice su trabajo.

### Etapa 3: Piloto automático (L)

> **Estado (2026-11-10): hecha, salvo las decisiones automáticas sobre ChangeSets (que se completaron el 2026-11-11, ver «Decisiones del agente» en la Etapa 6).** Robustez (`a95ec03`): tiempo máximo por ejecución configurable en la política, D7 (el motor se detiene si falla el consumo o al cerrar la app), aprobaciones pendientes cerradas al reconciliar, y el host reinicia el núcleo si muere. Autonomía por feature (manual, auto-aceptar, piloto) con aviso de costo obligatorio, autenticación por proveedor (suscripción primero, clave de API como segunda opción) y un piloto que recorre las tareas READY, acepta solo con auditoría y comprobaciones en verde, reintenta con el error como contexto (el último intento con el modelo de escalado), se pausa al acercarse al límite de uso y avisa con el motivo cuando necesita al usuario. **H4 probada en real** sobre el proyecto `todo-app` de la app (Claude `haiku`): el piloto cerró la feature FEAT-001 (TASK-001 y TASK-002, con dependencia) sin intervención en 41 s, con 13/13 pruebas en la rama de la feature.
>
> Pendiente: ChangeSets propuestos por el propio agente tras una ejecución y su clasificación según la política de decisiones del proyecto. Hoy ninguna ejecución propone cambios al plan, así que no hay decisiones que automatizar; se abordará cuando el agente pueda declararlos (por ejemplo, a partir del apartado "Pendiente" de su resumen de cierre).

Objetivo: H4. El usuario deja de ser orquestador.

- **Niveles de autonomía por feature:** `manual` (como hoy, valor por defecto), `auto-aceptar` (acepta solo si la auditoría y las pruebas pasan) y `piloto` (además elige y lanza la siguiente tarea). Se elige al iniciar el trabajo de cada feature, no para todo el proyecto.
- **Aviso de costo antes de activar `piloto`:** la app explica que el piloto encadena muchas ejecuciones, muestra el uso actual de la ventana de límite y cuántas tareas quedan en la feature, y recuerda que con suscripción se pausará al acercarse al límite. Recomienda clave de API del proveedor para uso intensivo.
- **Autenticación por proveedor:** primera opción, la suscripción del usuario (con pausas por límite); segunda opción, clave de API del proveedor para la autonomía. Se configura por proveedor (Claude Code, Codex) y la app indica cuál está activa en cada ejecución.
- **Ejecutor de feature:** recorre las tareas de una feature en orden de dependencias; ejecuta la siguiente `READY`; si las puertas pasan, acepta y continúa.
- **Reintentos con contexto:** si falla, reintenta con el error, el diff y la salida de las pruebas como contexto, hasta un máximo (diseño original: 2; el valor por defecto implementado es 3 intentos por tarea, `DEFAULT_AUTONOMY.maxAttempts`); el último reintento puede usar un modelo más capaz.
- **Escalado al usuario** solo cuando: fallos repetidos, una acción que la política no permite (con "Permitir y reintentar"), una decisión de arquitectura propuesta por el agente, un conflicto de merge o un límite de uso.
- **Decisiones automáticas según la política del proyecto:** cada proyecto define qué decisiones son importantes y deben esperar al usuario. Valores por defecto, derivados del grafo y de los niveles de autoridad: crear o cambiar un ADR, cambiar reglas del proyecto, tocar lo que una decisión aceptada fija, salirse del alcance de la feature en curso, borrar entidades o archivos, y cambiar dependencias del proyecto (`package.json` y similares). El resto (nuevas tareas o requisitos dentro de la feature, documentación de lo hecho) se aplica solo en nivel `piloto`. El agente puede además marcar una propuesta como importante, pero nunca puede rebajar una que la política marca como tal.
- **Presupuesto:** pausa automática cuando `rate_limit_event` supera un umbral configurable (por defecto 85 %) y reanudación al renovarse la ventana; tope de ejecuciones por sesión de piloto.
- **Robustez necesaria para correr sin vigilancia:** D7 (detener el motor si falla el consumo y al cerrar la app), tiempo máximo por ejecución, cerrar las aprobaciones pendientes de ejecuciones interrumpidas y reinicio automático del sidecar.
- Botón de parada y registro de cada decisión tomada por el piloto.

**Cierre:** una feature de `todo-app` con 3 a 5 tareas se cierra de punta a punta en nivel `piloto`, y cada intervención humana queda registrada con su motivo.

### Etapa 4: Portabilidad entre motores (M)

Objetivo: H3. El mismo workspace funciona con Claude Code y con Codex.

- Registro de adaptadores por `providerKey`; el orquestador y el planificador eligen el motor según el perfil o la tarea, no por cableado fijo.
- Volver a cablear `CodexAgentAdapter` y `CodexChangeSetPlanner` con el contrato actual: política de ejecución (rutas y comandos traducidos al sandbox de Codex), configuración del proveedor, modelos, eventos de acción denegada y entorno limpio.
- Elegir motor y modelo por tarea en la vista de Agentes y por propuesta en Planificar.
- Mismos fixtures y tests de contrato para los dos adaptadores.

**Cierre:** una feature con la mitad de las tareas en Claude Code y la otra mitad en Codex, sin reconstruir contexto a mano.

### Etapa 5: Demostración y medición (M, continuo)

> **Primera medición (2026-11-10, Claude `haiku`, 5 tareas sobre `todo-app`)** — informe en `docs/benchmarks/2026-11-10-todo-app-haiku.md`, herramienta en `scripts/benchmark/`, métricas por feature en la app (panel de autonomía y exportación a `reports/`). Resultado: **empate en calidad** (5/5 tareas y 13/13 pruebas ocultas en ambos brazos), **+38 % de tokens de entrada en el workspace** (sesión nueva por tarea; el contexto curado solo ocupó 0,9–2,5 k tokens), tiempo igual, y **0 mensajes humanos con el piloto frente a 5 en el chat**. Según el criterio de corte, **H1 no pasa en este escenario y H4 sí**. El escenario era demasiado fácil para exponer el problema que el proyecto ataca (conversaciones largas, temas mezclados, decisiones previas no repetidas); la siguiente medición debe diseñarse para eso antes de decidir.

> **Segunda medición (2026-11-11, 13 tareas en 3 features, decisiones encadenadas)** — `docs/benchmarks/2026-11-11-todo-v2-haiku.md`. Excluyendo una tarea con enunciado ambiguo que fallaron los tres brazos: chat largo 12/12, chat por feature 11/12, **workspace 10/12**; convención respetada 9/9, 8/9 y **7/9**; tokens sin caché 105 k, 120 k y **361 k**. El workspace pierde la convención porque el resumen de cierre no la conservó, porque las convenciones no se promueven a reglas del proyecto (nivel 1) y porque la búsqueda de texto mete en el contexto especificaciones de tareas pendientes de otras features. **H1 no pasa por segunda vez; H4 sí. Corresponde replantear** (ver propuestas en el informe y en la conversación del 2026-11-11).

> **Tercera medición, con correcciones (2026-11-11)** — `docs/benchmarks/2026-11-11-todo-v2-haiku-correcciones.md`. Con convenciones promovidas a reglas de nivel 1 y sin tareas pendientes en la búsqueda, el workspace **empata con el mejor chat en calidad (12/12, convención 9/9) sin intervención humana**, pero sigue gastando ~3,8 veces más tokens sin caché por abrir una sesión por tarea. Siguiente experimento: reutilizar la sesión dentro de una feature como caché.

> **Cuarta medición: sesión por feature (2026-11-11)** — `docs/benchmarks/2026-11-11-todo-v2-haiku-sesion-por-feature.md`. Misma calidad (12/12, 9/9), pero el costo ponderado sube a 839 k (frente a 603 k sin reutilizar y 414 k del chat largo): la sesión acumulada dispara las lecturas de caché. Queda como opción desactivada por defecto. **Conclusión de la Etapa 5 con Claude:** el workspace iguala en calidad al mejor chat y elimina la intervención humana, a ~1,5 veces el costo ponderado del chat largo. H1 en su forma original (mejor resultado o menos costo) no se cumple; la decisión sobre cómo seguir queda en manos del usuario.

> **Decisión del usuario (2026-11-11): apostar por la autonomía y la trazabilidad.** La propuesta de valor deja de ser "contexto más eficiente que un chat" y pasa a ser "el proyecto avanza solo, con la misma calidad que el mejor chat, cada decisión queda registrada y las convenciones se respetan entre features", aceptando un sobrecosto de ~1,5× en tokens. Se continúa con la Etapa 6 y luego la 4, y se buscan reducciones de costo donde no afecten la calidad (resúmenes de cierre más cortos, menos exploración redundante), midiendo cada cambio con `scripts/benchmark/`.

Objetivo: decidir con datos, según el criterio de corte de la sección 2.

- **Protocolo:** el mismo conjunto de tareas resuelto de tres formas: (a) Claude Code a mano en una conversación, (b) Graph Workspace con el contexto curado y (c) Graph Workspace en piloto automático. Primero en `todo-app`, después en `graphdev2` mismo.
- **Métricas automáticas por ejecución:** tokens, tiempo, reintentos, criterios cumplidos, acciones denegadas, cambios fuera de alcance e intervenciones humanas. Se guardan en el workspace y se exportan a un informe.
- Repetir H3 con Codex.
- Informe con la conclusión y la decisión: seguir, ajustar o replantear.

### Etapa 6: Grafo vivo (M)

Objetivo: ver el proyecto como una red que trabaja.

- Estado en vivo en el lienzo: la tarea en ejecución se ilumina, al cerrarse se activan las que desbloquea.
- Aristas que muestran qué contexto pasó de una tarea a otra (`TaskOutcome`, documentos, código).
- Camino crítico de la feature y progreso del piloto sobre el grafo.

Va al final a propósito: ayuda a entender el proyecto, pero no es lo que demuestra las hipótesis.

> **Hecho (2026-11-11):** cada tarea se colorea según su estado (la que está en curso pulsa, las cerradas y bloqueadas se atenúan); cada feature muestra "N/M tareas" y un distintivo "PILOTO" mientras el piloto trabaja; al seleccionar una tarea, el lienzo resalta las entidades que formaron el contexto de su última ejecución, con el color de su nivel de autoridad, y dibuja aristas punteadas hacia la tarea (consulta `graph:context_flow`, con leyenda y botón para ocultarlo). Verificado contra el workspace real de `todo-app`: TASK-002 recibió FEAT-001, los requisitos, el código de TASK-001 (nivel 4) y su resultado (nivel 5). Pendiente: camino crítico de la feature.

> **Decisiones del agente (2026-11-11):** al cerrar una tarea el agente puede proponer cambios al plan (bloque `propuestas` al final de su resumen, independiente del motor). Una política del proyecto (migración 006, editable en el formulario de política) clasifica cada operación en cinco categorías, automática o "preguntar", con un tope de tareas automáticas por feature (5 por defecto). Si todo es automático el cambio se aplica y el piloto sigue; si no, el piloto queda en espera con la razón y la propuesta pendiente en Planificación; una propuesta inválida no frena la ejecución. Verificado con haiku real: tras cerrar TASK-001 propuso la tarea `restar`, se aplicó sola y quedó lista. Pendiente: medir si las instrucciones extra del prompt cambian el costo ponderado con `scripts/benchmark/`.

> **Independencia entre lanzamientos (2026-11-11):** el contexto de una ejecución ahora se lee del commit de partida de su rama (`git show` con git fijado, tope de 2 MiB), no de la copia de trabajo del usuario, y el snapshot registra ese commit. El CLI de Claude se lanza con `--setting-sources project,local --disable-slash-commands` y sin memoria automática, así que no carga la configuración, los skills ni los plugins personales (HOME se conserva para la suscripción). Límites conocidos: los plugins integrados del CLI y los ajustes administrados siguen aplicando; que `~/.claude/CLAUDE.md` quede excluido se deduce del código del CLI, no de una ejecución; el planificador de ChangeSets aún no usa estos flags. Verificado con haiku real.

> **Mediciones 5 y 6 (2026-11-11):** el tope de turnos (`--max-turns`, columna `max_turns`, desactivado por defecto) no ahorra: nunca se alcanza. El arranque del CLI cuesta solo ~4 % del total; el 40 % es el prompt de la tarea, que crece con cada tarea cerrada, y el 51 % el trabajo. Agrupar tareas pequeñas (6 ejecuciones en vez de 13) bajó el costo ponderado de 591 k a 334 k (−43 %, por debajo del chat largo con 414 k) con 32/33 pruebas y convención 8/9, en una sola corrida. Informes en `docs/benchmarks/`. Siguiente en costo: agrupación en el piloto (opción) y recortar el prompt de contexto.

> **Inicio de proyecto y ramas (2026-11-11):** asistente de inicio (preguntas, propuesta única con visión, stack, reglas y plan, aprobación, notas para regenerar, cancelación real del motor), `repository:initialize`, rama de cada feature con el trabajo de sus dependencias, `feature:integrate` con botón, y bandeja de actividad. Verificado con haiku real (propuesta en Python al pedirlo con una nota, ~0,035 USD). Las pruebas de UI tenían fallos intermitentes bajo carga; se hicieron deterministas en `cd351b5`.

> **Interfaz y orquestador (2026-11-11):** bandeja de actividad (`activity:list`), tema claro/oscuro (tokens con contraste AA verificado) y shell con barra lateral, árbol, atajos y "siguiente paso". Los demás paneles se migraron al tema después, en `8be2e46` (ver `src/desktop/theme/MIGRACION.md`). El usuario aceptó las 8 decisiones de `docs/PROPUESTA_ORQUESTADOR_DE_INICIO.md` (asistente de inicio de proyecto con 2 aprobaciones, estado en tabla propia, `PROJECT_FOUNDATION` siempre pregunta, scaffold por el agente, sin `npm install`, opus en objetivo y stack, reiniciar `todo-app`, antes de Codex).

## 6. Orden y dependencias

Etapa 1 → Etapa 2 → Etapa 3 → Etapa 5 (medición con Claude) → Etapa 6 → Etapa 4 → Etapa 5 (medición con Codex).

Reordenado el 2026-11-10: la Etapa 4 pasa al final porque su prueba real necesita cuota de Codex, que no hay disponible ahora; preparar el código sin poder validarlo con el CLI real no compensa.

El protocolo de medición (Etapa 5) se define al empezar la Etapa 1 para registrar métricas desde la primera tarea real. Todo cambio se prueba primero con el motor simulado y después, una vez por etapa, con el motor real sobre una copia del proyecto.

## 7. Fuera de alcance por ahora

Exportar e importar el workspace, búsqueda semántica, un tercer motor (OpenCode), aprobaciones interactivas por MCP y la mayor parte de la configuración avanzada de la UI.

## 8. Riesgos

| Riesgo | Mitigación |
| :--- | :--- |
| Los fabricantes de los motores incorporan planificación, memoria y tareas en segundo plano, y la orquestación pierde valor. | El valor diferencial está en la memoria estructurada del proyecto, independiente del motor y persistente; la portabilidad (H3) lo protege. |
| H1 no se cumple: el agente explorando el repositorio rinde igual que con contexto curado. | Se mide pronto (Etapa 5) y hay criterio de corte. |
| El grafo se desincroniza del código. | Se actualiza solo con cada ejecución y propuesta (Etapa 2); el usuario no lo mantiene a mano. |
| Costo y límites: el piloto encadena muchas ejecuciones. | Modelos por rol, pausa por límite, tope por sesión; modo `api_key` para uso intensivo. |
| Términos de la suscripción: automatizar el CLI de forma prolongada es zona gris. | Cada persona con su propia suscripción y CLI sin modificar; para el piloto automático intensivo, clave de API. |
| La autonomía acepta código incorrecto. | Las pruebas son la puerta; sin comandos de verificación no hay aceptación automática; auditoría de rutas siempre activa. |

## 9. Decisiones

Tomadas (2026-11-10):

1. **Autonomía por feature**, con `manual` por defecto y aviso de costo antes de activar `piloto`.
2. **Autenticación:** suscripción como primera opción; clave de API del proveedor como segunda opción, recomendada para la autonomía intensiva.
3. **Decisiones importantes:** las define la política de cada proyecto, con valores por defecto derivados del grafo (ver Etapa 3). El agente puede marcar más, nunca menos.

4. **Rama que recibe el trabajo aceptado: una rama por feature** (por ejemplo `feature/gestion-tareas`), creada desde la rama activa al empezar la feature. Cada tarea aceptada se integra ahí con squash; al terminar la feature, el usuario la revisa completa y la fusiona a su rama principal. Así el trabajo autónomo queda separado hasta su revisión y descartarlo es borrar una rama.

Tomadas (2026-11-11):

5. **Apostar por la autonomía y la trazabilidad** tras las mediciones 1–4 (ver la Etapa 5): se acepta un sobrecosto de ~1,5× en tokens a cambio de calidad igual a la del mejor chat, cero intervención humana y decisiones registradas.
6. **Asistente de inicio de proyecto**, con las ocho decisiones de `docs/PROPUESTA_ORQUESTADOR_DE_INICIO.md`: MVP de 2 aprobaciones, estado en tabla propia, `PROJECT_FOUNDATION` siempre pregunta, scaffold como primera tarea del plan, sin `npm install`, `opus` para objetivo y stack, reinicio de `todo-app` y prioridad antes de la Etapa 4 (Codex).
7. **El tope de turnos (`--max-turns`) queda desactivado por defecto** y la reutilización de sesión por feature queda desactivada: ninguna ahorró costo en la medición (ver mediciones 4 y 5).
