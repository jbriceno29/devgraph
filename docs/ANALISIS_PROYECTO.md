> **Documento histórico (análisis del 2026-11-10).** Describe el estado del proyecto antes de la migración a Claude Code y de las Etapas 1 a 6; sus defectos y huecos se resolvieron o se reorganizaron. El estado vigente está en `docs/PLAN_DE_TRABAJO.md` (tabla de la sección 0) y el README.

# Análisis del proyecto Graph Workspace (`graphdev2`)

Fecha del análisis: 2026-11-10
Base revisada: árbol de trabajo actual (commit `9d3d859` + cambios de la Etapa 7 sin commitear)

**Alcance de la revisión.** Se leyeron `README.md`, los cuatro documentos de `docs/`, la configuración de build, el host Tauri (`src-tauri/src/lib.rs`), todo el núcleo TypeScript (`src/domain`, `src/application`, `src/infrastructure`, `src/shared`) y los contratos IPC. De la UI (`src/desktop`) y de `tests/` se revisó la estructura, las acciones disponibles y los casos cubiertos, no cada línea. **No se ejecutó la suite de pruebas ni la app**; los resultados "43 tests passed" provienen de `docs/PROGRESS.md` y no fueron reverificados. Los tres defectos del auditor de rutas (sección 4.1) sí se reprodujeron de forma aislada con Git y la misma función `glob`.

---

## 1. Resumen

- **Avance:** 7 de 8 etapas del plan están implementadas. Falta la Etapa 8 (ciclo de retroalimentación, merge, trazabilidad y prueba end-to-end).
- **Alineación con el objetivo:** la base construida sí corresponde al objetivo. El esquema SQL es idéntico al especificado, las capas respetan la arquitectura y los invariantes principales (DAG, matriz de aristas, commit híbrido SQLite + Markdown, contexto por niveles de autoridad, aislamiento en worktree) están implementados y con pruebas.
- **Lo que hoy impide cerrar el MVP:** además de la Etapa 8, hay 6 defectos que conviene reparar antes de continuar (sección 4.1) y varias capacidades que el escenario end-to-end necesita y que todavía no tienen camino desde la UI (sección 4.2): configurar reglas y comandos de verificación, pasar tareas a `READY`, ver el diff de una ejecución y crear `CodeReference`.
- **Riesgo operativo inmediato:** la Etapa 7 completa está sin commitear, y el repositorio solo tiene 2 commits.

---

## 2. Objetivo del proyecto

Según `DOMAIN.md` y `ARCHITECTURE.md`, Graph Workspace **no es otro agente de programación**. Es una plataforma de ingeniería de escritorio, local-first, que:

1. Mantiene la **memoria estructurada** del proyecto como un grafo tipado (módulos, features, requerimientos, tareas, ADRs, documentos, referencias de código) en SQLite, con los documentos en Markdown dentro del repositorio Git.
2. Prepara **contexto curado y reproducible** (`ContextSnapshot`) para cada tarea, priorizado por autoridad (reglas → ADRs → specs → código → histórico).
3. **Coordina motores externos** (Codex, Claude Code, OpenCode) mediante adaptadores, sin acoplarse a ninguno.
4. **Gobierna la ejecución**: worktree aislado, política de rutas y comandos, aprobaciones, auditoría del diff.
5. **Deja evidencia** de cada ejecución y devuelve el resultado al grafo.

La prueba de fuego del MVP es el recorrido completo: crear proyecto → análisis inicial con IA → PRD, arquitectura y grafo → planificar una feature en tareas con dependencias → ejecución aislada con un motor externo → validación de diff y tests → actualización de estado y evidencia en el grafo. El segundo criterio es cambiar de motor en la tarea siguiente sin perder contexto.

---

## 3. Estado por etapa

| Etapa | Estado | Observaciones |
| :--- | :--- | :--- |
| 1. Dominio + SQLite | Completa | DDL idéntico al plan (hay un test que lo compara byte a byte). `GraphTopologyService` valida matriz de aristas, ciclos y jerarquía. No existe un migrador versionado: es un único archivo `001` con `CREATE IF NOT EXISTS` y `user_version = 1`. |
| 2. Grafo + Canvas + Inspector | Completa | IPC tipado vía Tauri + sidecar Node. Canvas con filtros, inspector con relaciones e historial de ejecuciones. |
| 3. Artefactos y Markdown | Completa | Escritura atómica, watcher de `docs/`, plantillas, editor con detección de cambio externo. Un documento marcado `DRIFTED` permanece así hasta que se guarda desde la app; no hay acción "aceptar cambio externo". |
| 4. Planificación + ChangeSets | Completa | Validador, resolución de `tempId`, commit híbrido con rollback, ghost preview. La "edición de propuesta" es edición de JSON crudo y la vista es un formulario de un solo turno, no un chat. |
| 5. Context Engine | Completa con un hueco | Las 5 etapas del pipeline existen. El nivel 4 (código) queda siempre vacío en la práctica porque nada crea entidades `CodeReference`. No hay búsqueda semántica (el diseño la marca como progresiva). |
| 6. Integración de agentes | Completa | `CodexAgentAdapter`, `AgentOrchestrator`, eventos en SQLite y `events.jsonl`, monitor en vivo. Solo perfil `DEVELOPER` y un único adaptador. |
| 7. Gobernanza y worktrees | Implementada, **sin commitear**, con defectos | Worktree por ejecución, auditoría de rutas, `changes.patch`, `test-output.log`. Ver defectos en 4.1. El flujo de aprobaciones existe pero es inerte con Codex (`supportsApprovals: false`), lo cual está documentado. |
| 8. Feedback loop + E2E | **Pendiente** | Nada implementado todavía. Detalle en la sección 5. |

Desviaciones menores respecto a la documentación:

- `IMPLEMENTATION_PLAN.md` y `ARCHITECTURE.md` citan `docs/domain/DOMAIN.md` y `docs/architecture/ARCHITECTURE.md`; los archivos están planos en `docs/`.
- El diagrama Gantt del plan sigue mostrando la Etapa 2 como activa.
- La estructura de carpetas difiere de la sección 9 de la arquitectura (`infrastructure/ai` en vez de `agent-adapters/codex`, `ExecutionValidator` en infraestructura, `presentation/planning` en vez de `chat`, `desktop/shell/` vacío). No afecta el comportamiento; conviene actualizar el documento o mover los archivos.
- El dominio define las entidades como interfaces + funciones de transición, no como agregados con comportamiento. Es una simplificación razonable para el MVP.

---

## 4. Hallazgos

### 4.1 Por reparar (defectos)

**D1. Timeout del host Rust (60 s) menor que el del planificador (120 s), con IPC en serie.**
`src-tauri/src/lib.rs` espera cada respuesta con `recv_timeout(60 s)` manteniendo el mutex del sidecar, y `sidecar/main.ts` atiende las peticiones una por una. `CodexChangeSetPlanner` puede tardar hasta 120 s. Consecuencias: una propuesta que tarde más de un minuto devuelve error en la UI aunque Codex termine bien, y mientras dura cualquier petición larga el resto de la UI no puede consultar nada (los eventos sí siguen llegando).
*Corrección sugerida:* correlacionar respuestas por `id` con un mapa de pendientes en Rust (sin mutex durante la espera), procesar las peticiones del sidecar de forma concurrente y convertir `changeset:propose_from_chat` en un comando asíncrono que notifique por evento.

**D2. Los directorios ignorados generan falsas violaciones de sandbox.**
`ExecutionValidator` lista ignorados con `--directory`, por lo que recibe `node_modules/` y `dist/` como directorio. Tras quitar la barra final, `node_modules` no coincide con el patrón `node_modules/**` de la política por defecto. Resultado reproducido: si el agente ejecuta `npm install` o un build dentro del worktree, la ejecución termina en `FAILED` y se borran esos directorios.
*Corrección sugerida:* hacer que `dir/**` coincida también con `dir`, o listar ignorados sin `--directory`; decidir además si los ignorados deben exigir estar en `writablePaths` o solo no estar en `deniedPaths` (lo que describe `PROGRESS.md`).

**D3. `deniedPaths` solo protege la raíz.**
El patrón `.env*` se compila como `^\.env[^/]*$`. Reproducido: `src/.env` y `src/sub/.env.prod` pasan la auditoría porque caen dentro de `src/**` y no coinciden con el patrón denegado.
*Corrección sugerida:* tratar los patrones sin `/` como coincidencia por nombre de archivo en cualquier profundidad (semántica tipo gitignore) y añadir un test.

**D4. Ejecuciones huérfanas bloquean la tarea para siempre.**
El conjunto de ejecuciones activas vive en memoria. Si la app o el sidecar se cierran con una ejecución en `RUNNING`, `VALIDATING` o `AWAITING_APPROVAL`, el registro queda en ese estado en SQLite y `start()` rechaza cualquier nuevo intento con "Esta tarea ya tiene una ejecución activa". No hay reconciliación al arrancar.
*Corrección sugerida:* al abrir un proyecto, marcar como `FAILED` (motivo: interrumpida) toda ejecución no terminal que no esté en memoria. Añadir también un tiempo máximo por ejecución.

**D5. Carrera entre cancelar y validar.**
En `AgentOrchestrator.consume`, después de `await validator.validate(...)` se escribe el estado final a partir de una copia previa (`validating`) sin releer el registro. Si el usuario cancela durante la validación, `CANCELLED` se sobrescribe con `COMPLETED` o `FAILED`.
*Corrección sugerida:* releer la ejecución tras la validación y no escribir si ya es terminal.

**D6. Los documentos generados no llegan al worktree del agente.**
Aplicar un ChangeSet escribe los Markdown en `docs/` del checkout principal pero no los commitea. El worktree de la ejecución se crea desde `HEAD`, así que no contiene el PRD, las specs ni los planes recién generados. El agente los recibe en el prompt (vía `ContextSnapshot`) pero no existen como archivos en su directorio de trabajo, y un merge posterior puede chocar con ellos.
*Corrección sugerida:* decidir una política explícita: commitear automáticamente los documentos al aplicar un ChangeSet, o bloquear/advertir al iniciar una ejecución si `docs/` tiene cambios sin commitear.

**D7 (menor). El proceso del motor no se detiene cuando se rechaza una aprobación o falla el consumo de eventos.**
`consume` marca `FAILED` pero no llama a `adapter.cancel`; el `finally` del adaptador solo elimina la referencia al proceso hijo. Hoy no se manifiesta con Codex, pero afectará al primer adaptador con aprobaciones.

**D8 (menor). Directorios basura en el repositorio.**
Existen `integration}/` en la raíz y `tests/{unit,/`, producto de un `mkdir` con llaves mal expandido. Conviene eliminarlos.

### 4.2 Capacidades que el MVP necesita y aún no tienen camino

Estas no son errores del código existente; son huecos que impedirán completar el escenario end-to-end desde la interfaz.

1. **Sin configuración de proyecto.** El formulario de creación solo pide el nombre. No hay forma de editar `rules`, `techStack`, la `AutonomyPolicy` ni `allowedCommands`. Efecto: el nivel 1 del contexto siempre está vacío y la validación nunca ejecuta tests (la política por defecto tiene `allowedCommands: []`), por lo que "validación de diff y tests" no es alcanzable sin editar la base a mano.
2. **Sin gestión manual de estados.** Las entidades nacen en `DRAFT`. La única vía para pasar una tarea a `READY` o un ADR a `ACCEPTED` es un ChangeSet con `UPDATE_ENTITY_STATUS` (propuesto por Codex o escrito en JSON). Además, la transición a `READY` no verifica que las dependencias `DEPENDS_ON` estén en `DONE`, y el orquestador tampoco lo comprueba al iniciar.
3. **La tarea no cambia de estado al ejecutarse.** El dominio indica `READY → IN_PROGRESS` al iniciar la primera ejecución; el orquestador no actualiza el `WorkItem`. (La transición a `IN_REVIEW` es parte de la Etapa 8.)
4. **Sin visor de diff ni detalle forense.** Los diffs se guardan en `execution_file_diffs` y `changes.patch`, pero no existe el canal `execution:get_forensic_detail` previsto en la arquitectura ni una vista para leerlos. Es requisito previo para aprobar un merge.
5. **`CodeReference` y `Milestone` no se pueden crear.** Existen en el esquema y en la matriz de aristas, pero no hay operación de ChangeSet ni UI que los cree.
6. **Los cambios del agente no se commitean.** El validador deja las modificaciones sin commit en el worktree; `finalCommit` siempre es igual a `initialCommit`. El flujo de merge de la Etapa 8 necesita un commit en la rama `graphdev/...`.
7. **La política por defecto no permite archivos en la raíz.** `package.json`, `README.md` o archivos de configuración quedan fuera de `writablePaths`, así que cualquier tarea que añada una dependencia fallará la auditoría. Es una decisión válida, pero debe ser visible y editable.
8. **Un solo adaptador, cableado fijo.** `workspace-core.ts` instancia únicamente `CodexAgentAdapter` y el orquestador recibe un adaptador, no un registro. El segundo criterio de cierre del MVP exige otro motor.

### 4.3 Áreas de mejora

- **Legibilidad del código.** Gran parte del núcleo está escrito en líneas muy largas y densas (clases completas en pocas líneas, varias sentencias por línea). No hay ESLint ni Prettier en `package.json`. Formatear el código y añadir un linter reduciría mucho el costo de revisión y de diffs.
- **Diagnóstico.** El `stderr` del sidecar se descarta en `lib.rs`; un fallo del núcleo no deja rastro. Tampoco hay reinicio del sidecar si muere. Enviar `stderr` a un archivo de log en el directorio de datos.
- **Migraciones.** Añadir un ejecutor de migraciones basado en `user_version` antes de que existan bases de usuarios con datos; la Etapa 8 probablemente necesite cambios de esquema.
- **Búsquedas entre proyectos.** `entity:get_inspector_details`, `artifact:read`, `changeset:*`, `execution:*` y `context:get_snapshot` abren todas las bases para localizar un id. Incluir `projectId` en esos contratos.
- **Escala del prompt de planificación.** `CodexChangeSetPlanner` envía todas las entidades y relaciones del proyecto en cada propuesta. Limitar al subgrafo relevante cuando hay un `ContextSnapshot`.
- **Presupuesto de tokens.** Los niveles 1 a 3 se incluyen siempre, aunque superen `maxAllowedTokens`, sin aviso. La estimación es `caracteres / 4`. Añadir una advertencia cuando el bloque obligatorio excede el presupuesto.
- **Código duplicado.** `resolveCodexExecutable` está en `codex-cli-path.ts` y repetido dentro de `codex-change-set-planner.ts`.
- **Escrituras en lecturas.** `listProfiles` y `getAutonomyPolicy` ejecutan `ensureCodexDefaults` (inserciones) en cada llamada. Mover la siembra a la creación o apertura del proyecto.
- **Worktrees y ramas.** Nunca se limpian; se acumularán en el directorio de datos y en el repositorio del usuario.
- **CI.** No hay pipeline; `typecheck`, `test` y `cargo test` deberían correr en cada push.
- **Nombres.** Conviven "Graph Workspace", `graphdev2-workspace` y el remoto `devgraph`. Unificar.

---

## 5. Etapa 8: lo que falta por implementar

Entregables del plan, con las dependencias detectadas en este análisis:

1. **Evidencia en el grafo.** Al completar una ejecución: crear o actualizar `CodeReference` por cada archivo de `execution_file_diffs` y registrar aristas `MODIFIES` (y `GENERATED_BY` para documentos) con `provenance = 'EXECUTION'` y `execution_id`. Esto además llena el nivel 4 del Context Engine.
2. **Estados coordinados.** `READY → IN_PROGRESS` al iniciar, `→ IN_REVIEW` al completar, `→ DONE` tras aprobación; recalcular `BLOCKED`/`READY` de las tareas dependientes.
3. **Revisión y merge.** Vista de diff y log de pruebas, commit de los cambios en la rama de la ejecución, acción "Merge worktree & mark DONE", opción de solicitar ajustes (nueva ejecución sobre la misma tarea) y limpieza de worktree y rama.
4. **ChangeSet posterior a la ejecución.** Propuesta opcional (`originType: 'AGENT_EXECUTION'`) cuando el cambio requiere actualizar documentación.
5. **Exportar / importar** la base de conocimiento del proyecto, versionada, en `exports/`.
6. **Segundo adaptador** (Claude Code u OpenCode) y registro de adaptadores por `providerKey`, para demostrar continuidad al cambiar de motor.
7. **Prueba end-to-end** del escenario completo, automatizada con un adaptador falso y ejecutada al menos una vez con un motor real.

---

## 6. Siguientes pasos

Orden recomendado. Los pasos 1 a 3 son previos a la Etapa 8.

1. **Asegurar el trabajo actual.** Commitear la Etapa 7, eliminar `integration}/` y `tests/{unit,/`, y volver a correr `npm run typecheck`, `npm test` y `cargo test`.
2. **Reparar los defectos D1 a D6**, cada uno con su test:
   - D2 y D3 en `execution-validator.ts` (función `glob` y listado de ignorados).
   - D4 y D5 en `agent-orchestrator.ts` (reconciliación al abrir proyecto, relectura tras validar).
   - D1 en `lib.rs` y `sidecar/main.ts` (concurrencia y timeout).
   - D6: definir y aplicar la política sobre documentos sin commitear.
3. **Habilitar lo mínimo para operar desde la UI:** configuración de proyecto (reglas, política de autonomía, comandos de verificación), cambio manual de estado de tareas y ADRs con verificación de dependencias, y canal + vista de detalle forense (diff, patch, log).
4. **Implementar la Etapa 8** en este orden: estados coordinados → commit en la rama de ejecución → evidencia `MODIFIES`/`GENERATED_BY` y `CodeReference` → revisión y merge con limpieza → ChangeSet posterior → exportar/importar.
5. **Segundo adaptador** y registro de adaptadores.
6. **Prueba end-to-end** y cierre del MVP; actualizar `PROGRESS.md`, el Gantt del plan y las rutas citadas en los documentos.
7. **Deuda técnica en paralelo:** formateador y linter, log del sidecar, migrador versionado, CI.

### Decisiones que conviene tomar antes de empezar la Etapa 8

- ¿Los documentos generados por un ChangeSet se commitean automáticamente o lo hace el usuario?
- ¿El merge de una ejecución es fast-forward, merge commit o squash sobre la rama base?
- ¿Los archivos ignorados por Git deben respetar `writablePaths` o solo `deniedPaths`?
- ¿Qué motor será el segundo adaptador?
