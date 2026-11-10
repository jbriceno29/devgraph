# Plan de implementación: migrar de Codex a Claude Code (CLI con suscripción)

Fecha: 2026-11-10
Relacionado: `docs/ANALISIS_PROYECTO.md` (defectos D1 a D8, huecos del MVP y Etapa 8)

## 0. Estado

Actualizado: 2026-11-10, rama `feat/claude-code`.

| Fase | Estado |
| :--- | :--- |
| 0. Base limpia | **Hecha.** Etapa 7 y documentos commiteados (`d1f57a5`, `af44427`); carpetas rotas eliminadas; `typecheck`, `test`, `build` y `cargo test` en verde. |
| 1. Sondeo del CLI y fixtures | **Hecha.** Fixtures en `tests/fixtures/claude/`; sección 2 actualizada. Falta solo el error de límite de uso, que no se puede provocar. |
| 4. Defectos | **Parcial.** Hechos: endurecimiento del validador (`68e0c2d`), D2 y D3 (`2a90857`), D4 y D5 (`a1c493b`). Pendientes: ver la Fase 4. |
| 2. `ClaudeCodeAdapter` | **Implementada, falta la prueba real.** Adaptador, entorno limpio, comprobación de sesión, reglas de permisos desde la política, SIGINT con respaldo SIGTERM, siembra del proveedor y selección de modelo (IPC + selector en la vista de Agentes). Probado con los fixtures y con un `claude` simulado de punta a punta. Falta el criterio de cierre: una tarea real con Claude desde la app. |
| 3, 5, 6, 7 | Pendientes. |

La verificación del análisis (`docs/ANALISIS_PROYECTO.md`) confirmó D1 a D6 con reproducciones y encontró defectos nuevos. Todos los defectos abiertos están asignados a una fase en la sección 4; el análisis queda como referencia del diagnóstico, no como lista de trabajo.

## 1. Objetivo y alcance

Dejar de depender de Codex y usar **Claude Code a través de su CLI** (`claude -p`) como único motor, de modo que el consumo salga de la **suscripción** y no de créditos de API. Con ese motor funcionando se cierran los defectos previos a la Etapa 8, se implementa la Etapa 8 recortada y se valida en uso real entre dos personas si el contexto curado aporta valor.

Fuera de alcance por ahora: segundo adaptador, registro de adaptadores, exportar/importar, búsqueda semántica.

## 2. Lo verificado en la documentación de Claude Code

Fuente principal: https://code.claude.com/docs/en/headless (revisada hoy). Fuente de suscripción: https://support.claude.com/en/articles/11145838-using-claude-code-with-your-claude-subscription

| Necesidad | Qué existe en el CLI | Efecto en el diseño |
| :--- | :--- | :--- |
| Ejecución no interactiva | `claude -p "<prompt>"`; el prompt también puede entrar por stdin (límite 10 MB) | Mismo patrón que el adaptador actual (prompt por stdin, `cwd` = worktree). No hace falta un equivalente de `--cd`. |
| Streaming en vivo | `--output-format stream-json --verbose` (+ `--include-partial-messages` solo para deltas de tokens). La última línea es un mensaje `result` con respuesta, costo y metadatos de sesión. El evento `system/init` trae modelo, herramientas y `session_id`. | Se mapea a `AgentEvent`. Los deltas de tokens no son necesarios. |
| Salida estructurada | `--output-format json --json-schema '<schema>'`; el resultado llega en el campo `structured_output`, que puede faltar si Claude no produjo salida válida | Sirve para el planificador de ChangeSets. Hay que comprobar que el campo exista. |
| Reanudar sesión | `--resume <session_id>` y `--continue` | `supportsResume: true`. |
| Permisos sin interacción | `--allowedTools`, `--permission-mode` (`dontAsk`, `acceptEdits`, `auto`), `--permission-prompts none`. Una acción que requiere aprobación se **deniega** salvo que la resuelva un hook `PermissionRequest` o un `--permission-prompt-tool`. | Fase 1: sin aprobaciones interactivas; la política se traduce a reglas. Fase posterior opcional: puente de aprobaciones. |
| Cancelación | **SIGINT** termina el turno limpiamente; **SIGTERM** deja el turno sin terminar y sale con código 143 | El adaptador actual usa SIGTERM; cambiar a SIGINT con respaldo a SIGTERM. |
| Autenticación | Con sesión iniciada (`/login`) usa la suscripción. Si existe `ANTHROPIC_API_KEY`, el CLI usa esa clave **en lugar** de la suscripción y se cobra por API. | Quitar `ANTHROPIC_API_KEY` del entorno del hijo. No usar `--bare`: ese modo ignora el login de suscripción y exige clave de API. |
| Límites | Pro y Max tienen límite por ventana de 5 horas y límite semanal, compartidos con todo el uso de Claude y Claude Code | Las ejecuciones compiten con el uso manual de ambos. Hay que mostrar el error de límite y no lanzar ejecuciones en paralelo. |

### Términos de uso de la suscripción (revisados el 2026-11-10)

Fuente: https://code.claude.com/docs/en/legal-and-compliance.md

- La autenticación OAuth de la suscripción está pensada para el uso ordinario de Claude Code y de las aplicaciones nativas de Anthropic. Los límites anunciados de Pro y Max suponen uso ordinario e individual.
- Quien construye productos o servicios sobre Claude, incluso con el Agent SDK, debe usar clave de API.
- Está prohibido ofrecer el inicio de sesión de Claude.ai en una app propia, enrutar peticiones con credenciales de suscripción en nombre de otros usuarios, y recolectar, guardar o intermediar credenciales o tokens.
- Está permitido que un usuario inicie sesión en el binario de Claude Code **sin modificar** con su propia suscripción.
- Una aclaración de febrero de 2026 reforzó la prohibición para herramientas de terceros que usan los tokens de la suscripción (https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access). No menciona el uso del CLI oficial en scripts o con `claude -p`.

**Conclusión:** lanzar el `claude` oficial, sin modificar, como proceso hijo y con la sesión que cada persona ya tiene iniciada, sin tocar tokens, queda más cerca de lo permitido que de lo prohibido. Una app que automatiza el CLI en ejecuciones largas y autónomas no está descrita explícitamente, así que es una zona gris. Condiciones firmes: cada persona usa su propia suscripción (no se comparte una sesión) y, si Graph Workspace pasa a ser un producto para otros, esos usuarios deberán usar clave de API. Para una respuesta definitiva, la propia página indica contactar a ventas de Anthropic. Este resumen es una lectura de la documentación, no una opinión legal.

### Confirmado en la Fase 1 (CLI 2.1.318, 2026-11-10)

Fixtures y detalle de cada captura en `tests/fixtures/claude/README.md`.

- **Facturación:** con la sesión iniciada y el entorno limpio, `system/init` trae `apiKeySource: "none"` y `claude auth status --json` devuelve `authMethod: "claude.ai"`. Se usa la suscripción.
- **Reglas de ruta:** `Write(src/**)` y `Edit(src/**)` se resuelven relativas al `cwd`. Con ellas, `src/ok.ts` se permite y `README.md` en la raíz se deniega.
- **Lectura y comandos de solo lectura:** en `dontAsk`, el CLI **autoaprueba** comandos Bash de solo lectura dentro del `cwd` (`ls -la`, `reason_type: "subcommandResults"`) aunque Bash no esté en `--allowedTools`. Leer fuera del `cwd`, con Bash o con Read, se deniega. `--disallowedTools Bash` elimina Bash por completo.
- **Denegaciones:** cada una emite `system/permission_denied` (`tool_name`, `tool_use_id`, `decision_reason_type`, `message`) y se repite en `result.permission_denials` (`tool_name`, `tool_use_id`, `tool_input`). Una ejecución con denegaciones termina igualmente en `subtype: "success"`: el adaptador debe mostrarlas.
- **Decisión por herramienta:** los mensajes `user` con `tool_result` traen `tool_result_meta[].permission_decision` (`decision: accept|reject`, `reason_type: rule|mode|subcommandResults`).
- **Campos del stream:** `system/init` (`session_id`, `model`, `tools`, `permissionMode`, `claude_code_version`, `cwd`); `assistant` con `message.content[]` de tipo `text`, `thinking` o `tool_use` (`id`, `name`, `input`) y `message.usage`; `user` con `tool_result` (`tool_use_id`, `content`, `is_error`) y `tool_use_result` (para `Write`: `type`, `filePath`, `content`); `system/thinking_tokens`; `system/status`; `rate_limit_event` (`rate_limit_info.status`, `rateLimitType`, `resetsAt`, `unifiedWindows.five_hour|seven_day.utilization`); `result` (`subtype`, `is_error`, `result`, `stop_reason`, `terminal_reason`, `num_turns`, `usage`, `modelUsage`, `total_cost_usd`, `permission_denials`, `session_id`).
- **Salida estructurada:** un esquema JSON normal (propiedades opcionales) funciona con `--output-format json --tools "" --json-schema`; el objeto llega en `structured_output` y como texto en `result`.
- **Cancelación:** SIGINT → código de salida 0 y `result` final con `subtype: "error_during_execution"`, `is_error: true`, `terminal_reason: "aborted_streaming"`. SIGTERM → código 143 y sin `result`.
- **Herramientas por defecto:** `init.tools` incluye herramientas que una ejecución autónoma no debe ver (`CronCreate`, `RemoteTrigger`, `PushNotification`, `SendMessage`, `WebFetch`, `WebSearch`…). Usar `--tools` con la lista mínima, además de `--allowedTools`.

### Lo que sigue sin confirmar

1. **El error de límite de uso.** No se puede provocar a voluntad. Se tratará `rate_limit_event` con `status` distinto de `allowed` y un `result` con `is_error` y `api_error_status` como señales, y se capturará el primero que aparezca en uso real.
2. **El contrato de `--permission-prompt-tool`.** No hace falta mientras las aprobaciones sean estáticas (sección 6, decisión 4).

## 3. Decisiones de diseño

1. **Sin aprobaciones interactivas en la primera versión.** La política de autonomía ya define qué se permite; se traduce a `--permission-mode dontAsk` + `--allowedTools` + `--permission-prompts none`. Lo no permitido se deniega y queda registrado. Es más simple y determinista. El puente de aprobaciones por MCP queda como mejora posterior.
2. **`ExecutionValidator` sigue siendo la autoridad.** Las reglas del CLI son la primera barrera; la auditoría del diff contra `writablePaths` y `deniedPaths` es la que decide. No se relaja por tener reglas en el CLI.
3. **Cambio de motor detrás de los puertos existentes** (`AgentAdapterPort`, `ChangeSetPlannerPort`). El código de Codex se conserva sin cablear hasta que Claude esté probado y luego se elimina.
4. **Una ejecución a la vez.** Protege los límites de la suscripción y simplifica la depuración.
5. **Costo medido en tokens y tiempo, no en USD.** El campo `total_cost_usd` del resultado es una estimación del cliente; se guarda, pero las métricas relevantes son tokens usados y límites alcanzados.

## 4. Fases

Tamaños relativos: S = horas, M = ~1 día, L = varios días.

### Fase 0: Base limpia (S)

- Commitear la Etapa 7 y eliminar `integration}/` y `tests/{unit,/`.
- Correr `npm run typecheck`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml` y anotar el resultado real.
- Crear una rama de trabajo (`feat/claude-code`).

**Criterio de cierre:** árbol limpio, suites en verde, Etapa 7 en el historial. **Cumplido.**

### Fase 1: Sondeo del CLI y fixtures (S)

- Verificar `claude --version` en el equipo y que la sesión de suscripción está iniciada.
- Capturar salidas reales `stream-json` en `tests/fixtures/claude/`: (a) tarea que edita un archivo, (b) herramienta denegada por permisos, (c) salida con `--json-schema`, (d) cancelación con SIGINT, (e) error de límite de uso si se puede provocar.
- Registrar en este documento los campos reales y la sintaxis de reglas de ruta confirmada.
- Comprobar que, sin `ANTHROPIC_API_KEY` en el entorno, la ejecución se factura a la suscripción.

**Criterio de cierre:** fixtures versionados y la sección 2 actualizada con lo confirmado. **Cumplido** (salvo el caso (e), ver sección 2).

### Fase 2: `ClaudeCodeAdapter` (M)

Archivos:
- Nuevo `src/infrastructure/ai/claude-code-adapter.ts`, con `normalizeClaudeEvent` exportada y probada contra los fixtures.
- Generalizar `codex-cli-path.ts` en un resolvedor común de ejecutables (`GRAPHDEV_CLAUDE_PATH`, PATH y rutas habituales); eliminar la copia duplicada dentro del planificador de Codex.
- `agent-adapter-port.ts`: añadir a `AgentRunInput` lo necesario (`allowedTools`, `permissionMode`).
- `workspace-core.ts`: cablear el nuevo adaptador.
- `sqlite-agent-execution-repository.ts`: sembrar el proveedor `claude-code` y su perfil `DEVELOPER`; reemplazar `ensureCodexDefaults` por una siembra por proveedor, llamada al crear o abrir el proyecto y no en cada lectura. Migrar los proyectos existentes (perfil Codex → Claude).

Comportamiento:
- Argumentos base: `-p --output-format stream-json --verbose --permission-mode dontAsk --permission-prompts none --strict-mcp-config`, `--model` opcional, `--tools` con la lista mínima (`Read`, `Write`, `Edit`, `Glob`, `Grep` y `Bash` solo si la política tiene `allowedCommands`), y `--allowedTools` derivado de la política: `writablePaths` → `Write(<patrón>)` y `Edit(<patrón>)`, `allowedCommands` → `Bash(<cmd>)`. Sin `allowedCommands`, pasar `--disallowedTools Bash`, porque `dontAsk` autoaprueba Bash de solo lectura dentro del worktree.
- `rate_limit_event` → evento visible en la vista de Agentes (ventana y porcentaje); `system/permission_denied` → evento de acción denegada.
- Prompt por stdin, `cwd` = worktree.
- Entorno del hijo construido desde una lista blanca (`HOME`, `PATH`, `LANG`, `USER`, `TMPDIR`…), no heredado. Además de `ANTHROPIC_API_KEY`, hay que excluir `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDECODE` y cualquier `CLAUDE_CODE_*`: si Graph Workspace se lanza desde otra sesión de Claude (por ejemplo, la app de escritorio), esas variables redirigen la autenticación o cambian el modo del CLI.
- Antes de cada ejecución, `claude auth status --json` debe devolver `loggedIn: true`; si no, la ejecución falla con un mensaje claro sin lanzar el agente.
- Mapeo: `system/init` → `SESSION_INITIALIZED`; bloques de texto → `TEXT_DELTA`; `tool_use` → `TOOL_INVOCATION_STARTED` (y `FILE_TOUCHED` para Edit/Write); `tool_result` → `TOOL_INVOCATION_FINISHED`; `result` → `EXECUTION_FINISHED` o `EXECUTION_FAILED`; `system/api_retry` con `rate_limit` → evento visible.
- Cancelación: SIGINT; si el proceso sigue vivo tras unos segundos, SIGTERM.
- Capacidades: resume, streaming, cancelación, salida estructurada y worktrees en `true`; aprobaciones en `false`.
- `CLAUDE.md`, hooks y MCP del repositorio: sin `--bare` se cargan también en `-p`, sin diálogo de confianza. Se dejan cargar (sección 6, decisión 2) y se registra la ruta y el hash del `CLAUDE.md` en el `ContextSnapshot`.
- Modo de autenticación (`subscription` o `api_key`) y modelos por rol, leídos de `provider_connections.config_json` (sección 6, decisiones 1 y 3).
- **Selección de modelo:**
  - `--model` con alias (`haiku`, `sonnet`, `opus`), no IDs completos, para que no se rompa al salir modelos nuevos.
  - Modelo por defecto por rol (`planning`, `execution`) en `config_json` del proveedor, sin cambios de esquema.
  - `execution:start` acepta un `model` opcional; la vista de Agentes muestra un selector junto a "Iniciar" con el modelo por defecto preseleccionado.
  - El modelo real que confirma `system/init` (`init.model`) se guarda en `modelUsed` de la ejecución.

**Criterio de cierre:** una tarea `READY` real se ejecuta con Claude en un worktree, aparece el stream en la vista de Agentes, se audita el diff y la ejecución termina en `COMPLETED` o `FAILED` con motivo claro. Tests unitarios de `normalizeClaudeEvent` y un test de integración con un `claude` simulado (script que reproduce un fixture).

### Fase 3: Planificador con Claude y fix de D1 (M)

- Nuevo `ClaudeChangeSetPlanner` (`claude -p --output-format json --json-schema`, herramientas deshabilitadas o solo lectura, lectura de `structured_output`, error claro si falta). Extraer `normalizeOperation` a un módulo compartido.
- **D1 (confirmado):** con un planificador de 75 s, la UI recibe error a los 60 s pero la propuesta se guarda igual, y una consulta enviada a los 2 s responde a los 73 s. Corrección: correlacionar respuestas por `id` en `lib.rs` (mapa de pendientes, sin mantener el mutex durante la espera), atender peticiones del sidecar de forma concurrente, y convertir la propuesta en un comando que responde enseguida y notifica el resultado por evento. Subir el timeout no basta: sigue bloqueando la UI y contradice el criterio de cierre.
- Registrar el `stderr` del sidecar en un archivo de log y reiniciarlo si muere (hoy se descarta y, si cae, todas las peticiones fallan hasta reiniciar la app).
- Probar que un esquema JSON "normal" funciona; simplificar el actual si es posible. (Confirmado en la Fase 1.)
- Selector de modelo en la vista Planificar, con el modelo de planificación como valor por defecto.

**Criterio de cierre:** proponer y aplicar un ChangeSet con Claude desde la vista Planificar, incluso con una respuesta que tarde más de 60 s, sin bloquear el resto de la UI.

### Fase 4: Defectos previos a la Etapa 8 (M)

Cada uno con su test de regresión.

Hechos:
- **Validador endurecido** (`68e0c2d`): Git fijado al directorio de administración del worktree con `core.fsmonitor` y hooks desactivados (el agente podía hacer ejecutar un comando en el host reescribiendo el `.git` del worktree); el `.git` manipulado se restaura y falla la auditoría; symlinks que salen del worktree o llegan a rutas denegadas fallan; el contenido de rutas denegadas no se copia al parche ni a `execution_file_diffs`.
- **D2 y D3** (`2a90857`): patrones con semántica tipo gitignore; `dir/**` coincide con `dir`; patrones sin `/` valen a cualquier profundidad; rutas denegadas sin distinguir mayúsculas.
- **D4 y D5** (`a1c493b`): reconciliación de ejecuciones interrumpidas al abrir el proyecto y al iniciar; cancelar huérfanas; `CANCELLED` se persiste antes de detener el motor y no se sobrescribe tras validar; worktree y rama se eliminan si la preparación falla o se cancela antes de que el agente corra.

Pendientes:
- **D6:** commit automático de los documentos al aplicar un ChangeSet, rechazo si esas rutas tenían cambios sin commitear, y bloqueo de `execution:start` mientras algún documento de artefacto no esté en `HEAD` (sección 6, decisión 5). Confirmado: un documento recién creado no existe en el worktree del agente, y tampoco llegó al prompt cuando colgaba de la raíz del proyecto.
- **Atomicidad del applier** (junto con D6): hoy se mueven los archivos y después se hace commit en SQLite. Si el proceso muere entre ambos, quedan Markdown sin filas y `.bak` huérfanos; si falla el borrado de un `.bak` tras el commit, se revierten los archivos con la base ya confirmada. Corrección: borrar backups sin revertir tras el commit, y al abrir el proyecto limpiar `.tmp`/`.bak` y reconciliar documentos sin fila.
- **`ContextSnapshot` reproducible:** hoy sella `HEAD` pero lee el árbol de trabajo. Con D6 resuelto (documentos siempre en `HEAD`), leer las fuentes con `git show HEAD:<ruta>` o registrar que el contenido no estaba commiteado.
- **D7:** detener el proceso del motor cuando falla el consumo o se rechaza una acción; `core.close()` debe cancelar las ejecuciones activas.
- **Tiempo máximo por ejecución**, configurable en la política; al vencer, cancelar el motor y marcar `FAILED` con motivo.
- Al reconciliar una ejecución interrumpida, cerrar sus solicitudes de aprobación `PENDING`.

**Criterio de cierre:** una ejecución que corre `npm install` o un build en el worktree no falla por la auditoría; `src/.env` se detecta; reiniciar la app con una ejecución en curso no deja la tarea bloqueada (los tres ya se cumplen); el agente encuentra en su worktree los documentos que generó el último ChangeSet; ninguna ejecución queda corriendo indefinidamente.

### Fase 5: Operación mínima desde la UI (M a L)

- Configuración del proyecto: reglas (nivel 1 del contexto), `techStack`, `AutonomyPolicy` y comandos de verificación (`allowedCommands`).
- Modelos por defecto de cada rol editables desde la UI; opcionalmente `--fallback-model` para que el CLI pruebe otro modelo si el elegido está saturado o al límite.
- Cambio manual de estado de tareas y ADRs, comprobando que las dependencias `DEPENDS_ON` estén en `DONE` antes de pasar a `READY`.
- Canal `execution:get_forensic_detail` y vista de detalle: diff por archivo, `changes.patch`, `test-output.log`.
- Lista de acciones denegadas de la ejecución con el botón "Permitir y reintentar" (añade a `allowedCommands` y lanza una nueva ejecución).

**Criterio de cierre:** se puede recorrer el flujo completo sin tocar la base de datos a mano.

### Fase 6: Etapa 8 recortada (L)

En este orden:
1. `READY → IN_PROGRESS` al iniciar y `→ IN_REVIEW` al completar.
2. Migración `002` (`base_branch` en `agent_executions`) y commit de los cambios en la rama de la ejecución (hoy `finalCommit` siempre es igual a `initialCommit`).
3. Evidencia: `CodeReference` por archivo modificado y aristas `MODIFIES` (y `GENERATED_BY` para documentos) con `provenance = 'EXECUTION'`.
4. Revisión y merge: aprobar o pedir ajustes, squash hacia la rama base, `DONE`, desbloqueo de dependientes, limpieza de worktree y rama; conflicto de merge deja la tarea en `IN_REVIEW` con aviso.
5. ChangeSet posterior a la ejecución (`originType: 'AGENT_EXECUTION'`) cuando haya que actualizar documentación.

**Criterio de cierre:** el escenario completo (crear proyecto → documentos y grafo → planificar feature → ejecutar → validar → estado y evidencia en el grafo) funciona de punta a punta, primero con un adaptador simulado y luego con Claude real.

### Fase 7: Uso real y medición (continuo, 2 semanas)

- Usar el sistema sobre `graphdev2` mismo con 8 a 10 tareas reales.
- Para una parte de ellas, ejecutar la misma tarea con y sin `ContextSnapshot` y comparar: criterios de aceptación cumplidos, número de reintentos, tokens, tiempo y violaciones de política.
- Registrar los límites de suscripción alcanzados.

**Criterio de cierre:** una conclusión escrita sobre si el contexto curado mejora el resultado lo bastante para justificar el costo de mantener el grafo.

## 5. Riesgos

| Riesgo | Mitigación |
| :--- | :--- |
| `ANTHROPIC_API_KEY` presente en el entorno facturaría por API sin avisar | Quitarla del entorno del hijo; comprobarlo en la Fase 1 y mostrar la fuente de autenticación si el CLI la expone |
| Límite de 5 horas o semanal alcanzado a media ejecución | Detectar el error, marcar la ejecución como fallida recuperable con mensaje claro, una ejecución a la vez |
| Formato del stream cambia entre versiones del CLI | Fixtures versionados, pruebas del normalizador, registrar la versión del CLI en cada ejecución |
| Hooks o `CLAUDE.md` del repositorio alteran la ejecución | Decisión explícita en Fase 2; auditoría del diff sigue vigente |
| Reglas de permisos del CLI no equivalen a la política del producto | El validador es la autoridad; pruebas con acciones denegadas |
| Las reglas de uso de la suscripción cambian o se interpretan en contra de este uso (zona gris) | Cada persona con su propia suscripción, CLI oficial sin modificar, sin tocar tokens; autenticación configurable (`subscription` o `api_key`) para cambiar sin tocar código |

## 6. Decisiones tomadas

Resuelven las preguntas abiertas de la versión anterior de este plan.

1. **Autenticación: se intenta con la sesión del CLI.** Se decide usar la sesión de suscripción que cada persona ya tiene iniciada en `claude`, para validar el producto entre dos personas. Se revisaron los términos (sección 2): es una zona gris pero cercana a lo permitido, bajo estas reglas: cada persona usa su propia suscripción; la app solo lanza el CLI oficial sin modificar como proceso hijo y nunca lee ni reenvía tokens OAuth ni el llavero; y no se distribuye el producto a terceros apoyado en suscripción. El modo de autenticación es configuración (`subscription` o `api_key`) en `provider_connections.config_json`, de modo que pasar a clave de API no requiere tocar código. Si Anthropic aclara o cambia las reglas, o el producto se abre a más usuarios, se cambia a `api_key`.
2. **`CLAUDE.md` y hooks del repositorio.** Se dejan cargar. El `CLAUDE.md` del worktree está en el `initial_commit`, por lo que es reproducible; su ruta y hash se registran en el `ContextSnapshot`. El `ContextSnapshot` prevalece sobre cualquier otra instrucción (ya lo indica el prompt) y la auditoría del diff sigue siendo la autoridad. Si durante la Fase 7 aparecen conflictos, se evalúa aislar la ejecución.
3. **Modelo por defecto.** Planificación con el modelo más capaz; ejecución con uno intermedio para consumir menos del límite compartido. Ambos se configuran en `config_json` del proveedor, sin cambios de esquema. Una tarea de prioridad alta, o que haya fallado dos veces, puede reintentarse con el modelo más capaz a elección del usuario.
4. **Aprobaciones.** Política estática, sin puente MCP. La vista de Agentes muestra las acciones denegadas (`permission_denials` del resultado) y ofrece "Permitir y reintentar": añade el comando a `allowedCommands` y lanza una nueva ejecución. El puente MCP solo se implementa si ese ciclo resulta molesto en el uso real.
5. **Documentos, commits y merge.**
   - Los documentos escritos por un ChangeSet se commitean automáticamente en la rama actual, solo esos archivos, con el mensaje `docs(graph): <título> [changeset <id>]`.
   - Si esas rutas tenían cambios sin commitear, se rechaza aplicar el ChangeSet.
   - Si el commit falla después de escribir, el ChangeSet queda aplicado, los documentos quedan marcados como pendientes y `execution:start` se bloquea mientras algún documento de artefacto no esté en `HEAD` (resuelve D6).
   - El merge de una ejecución es **squash** hacia la rama sobre la que se inició, con el mensaje `TASK-012: título` y el id de ejecución. El detalle queda en `changes.patch` y `execution_file_diffs`.
   - Cada ejecución registra su rama base (migración `002`, columna `base_branch`).
   - Ante un conflicto de merge, la tarea queda en `IN_REVIEW` con aviso; la salida es una nueva ejecución sobre la base actualizada. No se resuelven conflictos automáticamente.
   - Al pasar a `DONE` se eliminan el worktree y la rama.

## 6.1 Pendientes que quedan abiertos

- Si se quiere certeza sobre el uso del CLI automatizado con suscripción, consultar a ventas de Anthropic (no bloquea el arranque).
- Confirmar en la Fase 1 la sintaxis de reglas de ruta y el contrato de `--permission-prompt-tool` (este último solo si se llega a necesitar).

## 7. Orden de arranque sugerido

Fase 0 y Fase 1 el mismo día; Fase 2 y 3 a continuación; lo pendiente de la Fase 4 (sobre todo D6) antes de la primera ejecución real con Claude sobre un proyecto con documentos, y el resto antes de cualquier uso prolongado. Las Fases 5 y 6 pueden solaparse parcialmente.
